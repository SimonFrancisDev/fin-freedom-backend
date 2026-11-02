import { randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';
import env from '../config/env.js';
import { getProvider } from '../blockchain/provider.js';
import { getFreedomPlusContracts } from '../blockchain/freedomPlusContracts.js';
import { getContracts } from '../blockchain/contracts.js';
import { legacyRewardFunding } from './nftRewardFundingRecovery.js';
import Job from '../models/NftRewardDistributionJob.js';
import Snapshot from '../models/FreedomPlusRewardSnapshot.js';
import { buildFreedomPlusRewardSnapshot } from './freedomPlusRewardSnapshotService.js';
import {
  rewardCyclesReadyForSnapshot, parseFirstDistributionAt, assertRewardSnapshot,
} from './nftRewardSchedule.js';

const processId = randomUUID();
const LEASE_MS = 10 * 60_000;
let timer;
let running;
let stopped = true;

export async function runNftRewardDistributionPass(dependencies = {}) {
  const {
    env: config = env, Job: jobs = Job, Snapshot: snapshots = Snapshot,
    getProvider: providerFactory = getProvider,
    getFreedomPlusContracts: contractsFactory = getFreedomPlusContracts,
    getContracts: ffContractsFactory = getContracts,
    legacyRewardFunding: recoveryFunding = legacyRewardFunding,
    Wallet: Signer = Wallet, buildSnapshot = buildFreedomPlusRewardSnapshot,
    shouldStop = () => stopped,
  } = dependencies;
  return executePass(config, jobs, snapshots, providerFactory, contractsFactory, Signer, buildSnapshot,
    shouldStop, ffContractsFactory, recoveryFunding);
}

async function executePass(env, Job, Snapshot, getProvider, getFreedomPlusContracts, Wallet,
  buildFreedomPlusRewardSnapshot, shouldStop, getFFContracts, recoveryFunding) {
  const now = new Date();
  const periods = rewardCyclesReadyForSnapshot(env.NFT_REWARD_FIRST_DISTRIBUTION_AT, now);
  // Before the first cutoff, after snapshot freeze, and after completion, no RPC reads are made.
  for (const target of periods) {
    if (shouldStop()) return;
    const distributionDue = target.distributionAt.getTime() <= now.getTime();
    const settledStatuses = distributionDue
      ? ['complete', 'empty']
      : ['snapshotted', 'complete', 'empty'];
    const key = { chainId: env.CHAIN_ID,
      distributor: env.FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS.toLowerCase(),
      periodId: target.periodId };
    await Job.updateOne(key, { $setOnInsert: key }, { upsert: true });
    const job = await Job.findOneAndUpdate({
      ...key, status: { $nin: settledStatuses }, leaseUntil: { $lt: new Date() },
    }, { $set: { status: 'running', leaseOwner: processId, leaseUntil: new Date(Date.now() + LEASE_MS) } },
    { new: true }).lean();
    if (!job) {
      const existing = await Job.findOne(key).lean();
      if (!settledStatuses.includes(existing?.status)) return;
      continue;
    }
    const owned = { ...key, leaseOwner: processId };
    try {
      const provider = getProvider();
      if (Number(BigInt(await provider.send('eth_chainId', []))) !== env.CHAIN_ID) throw new Error('NFT worker chain mismatch');
      const contracts = getFreedomPlusContracts(provider);
      const signer = new Wallet(env.NFT_REWARD_OPERATOR_PRIVATE_KEY, provider);
      const distributor = contracts.nftRewardDistributor.connect(signer);
      const configuredFirstDistribution = BigInt(
        Math.floor(parseFirstDistributionAt(env.NFT_REWARD_FIRST_DISTRIBUTION_AT).getTime() / 1000)
      );
      if (await distributor.firstDistributionAt() !== configuredFirstDistribution) {
        throw new Error('NFT worker schedule differs from the on-chain cycle schedule');
      }
      const id1Wallet = await getFFContracts().levelManager.connect(provider).id1Wallet();
      if (!(await distributor.rewardExcluded(id1Wallet))) {
        throw new Error('NFT ID1 reward exclusion is not active on chain');
      }
      const snapshot = await buildFreedomPlusRewardSnapshot({
        ...target,
        excludedWallets: [id1Wallet],
      });
      if (!distributionDue) {
        await Job.updateOne(owned, { $set: { status: 'snapshotted', lastError: '' } });
        return;
      }
      let period = await distributor.periodOf(target.periodId);
      const token = await distributor.rewardToken();
      if ((await distributor.vault()).toLowerCase() !== contracts.nftPoolVault.target.toLowerCase()) {
        throw new Error('NFT distributor and worker vault mismatch');
      }
      if (!period.created) {
        await recoveryFunding({ chainId: env.CHAIN_ID, cycleId: target.cycleId,
          distributor: env.FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS, token,
          vault: contracts.nftPoolVault.target, provider });
        const operator = await distributor.rewardOperator();
        if (operator.toLowerCase() !== signer.address.toLowerCase()) throw new Error('NFT worker is not the authorized reward operator');
        // Freeze eligibility, not funding. Migrated funds are already included
        // in the live unreserved pool and must not be added a second time.
        const budget = await contracts.nftPoolVault.unreservedBalance(token);
        if (budget === 0n) {
          await Job.updateOne(owned, { $set: { status: 'empty', lastError: '' } });
          continue;
        }
        if (await provider.getBalance(signer.address) === 0n) throw new Error('NFT reward operator needs native gas funding');
        const renewed = await Job.updateOne({ ...owned, leaseUntil: { $gt: new Date() } },
          { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
        if (renewed.matchedCount !== 1) throw new Error('NFT publication lease lost');
        await Job.updateOne(owned, { $set: { poolAmount: budget.toString() } });
        job.poolAmount = budget.toString();
        const tx = await distributor.createCycle(target.cycleId, budget, snapshot.roots, snapshot.counts);
        await tx.wait(env.SYNC_CONFIRMATIONS || 1);
        await Job.updateOne(owned, { $push: { transactionHashes: tx.hash } });
        await Snapshot.updateOne({ chainId: env.CHAIN_ID, periodId: target.periodId },
          { $set: { publishedTxHash: tx.hash } });
        period = await distributor.periodOf(target.periodId);
      }
      // Published amounts stay fixed across payout retries, regardless of inflow.
      if (job.poolAmount && BigInt(job.poolAmount) !== BigInt(period.poolAmount)) {
        throw new Error('Published NFT budget differs from the saved publication budget');
      }
      assertRewardSnapshot(period, snapshot);
      await Job.updateOne(owned, { $set: { poolAmount: period.poolAmount.toString() } });
      await Snapshot.updateOne({ chainId: env.CHAIN_ID, periodId: target.periodId },
        { $set: { status: 'published' } });
      const cursor = Number(job.cursor || 0);
      const batch = snapshot.eligibility.slice(cursor, cursor + 25);
      if (batch.length) {
        if (await provider.getBalance(signer.address) === 0n) throw new Error('NFT reward operator needs native gas funding');
        const renewed = await Job.updateOne({ ...owned, leaseUntil: { $gt: new Date() } },
          { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
        if (renewed.matchedCount !== 1) throw new Error('NFT payout lease lost');
        const tx = await distributor.distributeBatch(target.periodId, batch.map((entry) => entry.wallet),
          batch.map((entry) => entry.tier), batch.map((entry) => entry.proof));
        await tx.wait(env.SYNC_CONFIRMATIONS || 1);
        await Job.updateOne(owned, { $set: { cursor: cursor + batch.length, lastError: '',
          status: cursor + batch.length >= snapshot.eligibility.length ? 'complete' : 'pending' },
        $push: { transactionHashes: tx.hash } });
        console.log('[NFT_AUTO_DISTRIBUTION_BATCH]', { periodId: target.periodId, members: batch.length, txHash: tx.hash });
      } else {
        await Job.updateOne(owned, { $set: {
          status: snapshot.eligibility.length ? 'complete' : 'empty', lastError: '',
        } });
      }
    } catch (error) {
      // Keep credentials and provider URLs out of worker logs.
      const message = String(error.shortMessage || error.message || 'NFT distribution failed')
        .replace(/https?:\/\/\S+/g, '[RPC]').slice(0, 300);
      await Job.updateOne(owned, { $set: { status: 'pending', lastError: message } });
      console.error('[NFT_AUTO_DISTRIBUTION_FAILED]', { periodId: target.periodId, message });
    } finally {
      await Job.updateOne(owned, { $set: { leaseUntil: new Date(0), leaseOwner: '' } });
    }
    return; // Bounded work: at most one period/batch per timer pass.
  }
}

export function startNftRewardDistributionWorker() {
  if (!env.RUN_INDEXER || !env.FREEDOM_PLUS_ENABLED || !env.NFT_AUTO_DISTRIBUTION_ENABLED || timer) return;
  rewardCyclesReadyForSnapshot(env.NFT_REWARD_FIRST_DISTRIBUTION_AT);
  if (!env.NFT_REWARD_OPERATOR_PRIVATE_KEY) throw new Error('NFT reward operator key is required');
  stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = runNftRewardDistributionPass().catch(() => console.error('[NFT_AUTO_DISTRIBUTION_FAILED]', { message: 'Worker database or configuration failure' }))
      .finally(() => { running = null; });
  };
  timer = setInterval(tick, 60_000);
  timer.unref?.();
  tick();
}

export async function stopNftRewardDistributionWorker() {
  stopped = true;
  clearInterval(timer);
  timer = null;
  if (running) await running;
}
