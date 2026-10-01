import { randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';
import env from '../config/env.js';
import { getProvider } from '../blockchain/provider.js';
import { getFreedomPlusContracts } from '../blockchain/freedomPlusContracts.js';
import Job from '../models/NftRewardDistributionJob.js';
import Snapshot from '../models/FreedomPlusRewardSnapshot.js';
import { buildFreedomPlusRewardSnapshot } from './freedomPlusRewardSnapshotService.js';
import { dueRewardPeriods, assertRewardSnapshot } from './nftRewardSchedule.js';

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
    Wallet: Signer = Wallet, buildSnapshot = buildFreedomPlusRewardSnapshot,
    shouldStop = () => stopped,
  } = dependencies;
  return executePass(config, jobs, snapshots, providerFactory, contractsFactory, Signer, buildSnapshot, shouldStop);
}

async function executePass(env, Job, Snapshot, getProvider, getFreedomPlusContracts, Wallet,
  buildFreedomPlusRewardSnapshot, shouldStop) {
  const periods = dueRewardPeriods(env.NFT_REWARD_FIRST_PERIOD);
  // Before the first cutoff and after completion, the timer performs no RPC reads.
  for (const target of periods) {
    if (shouldStop()) return;
    const key = { chainId: env.CHAIN_ID,
      distributor: env.FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS.toLowerCase(),
      periodId: target.periodId };
    await Job.updateOne(key, { $setOnInsert: key }, { upsert: true });
    const job = await Job.findOneAndUpdate({
      ...key, status: { $nin: ['complete', 'empty'] }, leaseUntil: { $lt: new Date() },
    }, { $set: { status: 'running', leaseOwner: processId, leaseUntil: new Date(Date.now() + LEASE_MS) } },
    { new: true }).lean();
    if (!job) {
      const existing = await Job.findOne(key).lean();
      if (!['complete', 'empty'].includes(existing?.status)) return;
      continue;
    }
    const owned = { ...key, leaseOwner: processId };
    try {
      const provider = getProvider();
      if (Number((await provider.getNetwork()).chainId) !== env.CHAIN_ID) throw new Error('NFT worker chain mismatch');
      const contracts = getFreedomPlusContracts(provider);
      const signer = new Wallet(env.NFT_REWARD_OPERATOR_PRIVATE_KEY, provider);
      const distributor = contracts.nftRewardDistributor.connect(signer);
      const snapshot = await buildFreedomPlusRewardSnapshot(target);
      let period = await distributor.periodOf(target.periodId);
      if (!period.created) {
        const operator = await distributor.rewardOperator();
        if (operator.toLowerCase() !== signer.address.toLowerCase()) throw new Error('NFT worker is not the authorized reward operator');
        if (!snapshot.eligibility.length) {
          await Job.updateOne(owned, { $set: { status: 'empty', lastError: '' } });
          continue;
        }
        const token = await distributor.rewardToken();
        // Do not distribute funds that arrived after this period's cutoff.
        const historical = await contracts.nftPoolVault.unreservedBalance(token, { blockTag: snapshot.cutoffBlock });
        const available = await contracts.nftPoolVault.unreservedBalance(token);
        const budget = job.poolAmount ? BigInt(job.poolAmount) : (historical < available ? historical : available);
        if (budget === 0n) {
          if (historical > 0n) throw new Error('Cutoff funds are unavailable; operator review required');
          await Job.updateOne(owned, { $set: { status: 'empty', lastError: '' } });
          continue;
        }
        if (budget > available) throw new Error('NFT reward pool budget no longer available');
        await Job.updateOne(owned, { $set: { poolAmount: budget.toString() } });
        const tx = await distributor.createPeriod(target.year, target.month, budget, snapshot.roots, snapshot.counts);
        await tx.wait(env.SYNC_CONFIRMATIONS || 1);
        await Job.updateOne(owned, { $push: { transactionHashes: tx.hash } });
        period = await distributor.periodOf(target.periodId);
      }
      assertRewardSnapshot(period, snapshot);
      await Snapshot.updateOne({ chainId: env.CHAIN_ID, periodId: target.periodId },
        { $set: { status: 'published' } });
      const cursor = Number(job.cursor || 0);
      const batch = snapshot.eligibility.slice(cursor, cursor + 25);
      if (batch.length) {
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
        await Job.updateOne(owned, { $set: { status: 'complete', lastError: '' } });
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
  dueRewardPeriods(env.NFT_REWARD_FIRST_PERIOD);
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
