// Read-only mainnet audit. No signer, database writes, or transaction submission.
import fs from 'node:fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Contract, JsonRpcProvider, formatUnits } from 'ethers';
import { buildTree, rewardLeaf } from '../src/services/freedomPlusMerkle.js';
import plan from '../src/config/nftRewardFundingRecovery.json' with { type: 'json' };

dotenv.config({ quiet: true });
const provider = new JsonRpcProvider(process.env.AUDIT_RPC_URL, 137, { batchMaxCount: 1 });
const abi = (name) => JSON.parse(fs.readFileSync(`src/blockchain/abis/${name}.abi.json`, 'utf8'));
const memberAddress = '0xef54b5B9038A282c651E2992B885D074fb43DcDb';
const membership = new Contract(memberAddress, abi('freedom-plus/FreedomNFTMembership'), provider);
const distributor = new Contract(plan.distributor, abi('freedom-plus/FreedomNFTRewardDistributor'), provider);
const vault = new Contract(plan.vault, abi('freedom-plus/FreedomNFTPoolVault'), provider);
const token = new Contract(plan.token, ['function balanceOf(address) view returns (uint256)'], provider);
const ff = new Contract('0x0E9De0F24eB4774834A2c4A63eaBa8356A4A4B53', abi('levelManager'), provider);
const format = (value) => formatUnits(value, 6);

async function holdersAt(blockTag) {
  const at = { blockTag };
  const next = Number(await membership.nextTokenId(at));
  if (!Number.isSafeInteger(next) || next > 500) throw new Error('NFT enumeration exceeds audit bound');
  const holders = new Map();
  for (let id = 1; id < next; id += 1) {
    let wallet;
    try { wallet = (await membership.ownerOf(id, at)).toLowerCase(); }
    catch (error) {
      let reason;
      try { reason = membership.interface.parseError(error.data)?.name; } catch {}
      if (reason === 'ERC721NonexistentToken') continue;
      throw new Error(`Cannot verify NFT owner at token ${id}: ${error.shortMessage || error.message}`);
    }
    const member = await membership.membershipOf(wallet, at);
    if (Number(member.tokenId) !== id || holders.has(wallet)) throw new Error('NFT ownership consistency failed');
    holders.set(wallet, { wallet, tokenId: id, tier: Number(member.tier),
      rewardEligible: member.rewardEligible, lockedFGT: member.lockedFGT.toString(), lockedFPT: member.lockedFPT.toString() });
  }
  return [...holders.values()];
}

try {
  if (Number(BigInt(await provider.send('eth_chainId', []))) !== 137) throw new Error('Not Polygon mainnet');
  const head = await provider.getBlock('latest');
  const at = { blockTag: head.number };
  const times = await distributor.cycleTimes(1, at);
  const boundary = await provider.getBlock(plan.cutoffBlock);
  const next = await provider.getBlock(plan.cutoffBlock + 1);
  if (boundary.timestamp >= Number(times[1]) || next.timestamp < Number(times[1])) throw new Error('Cutoff block mismatch');
  if ((await distributor.vault(at)).toLowerCase() !== plan.vault.toLowerCase()) throw new Error('Vault mismatch');
  const id1 = await ff.id1Wallet(at);
  if (!(await distributor.rewardExcluded(id1, at))) throw new Error('ID1 exclusion is not active');
  const membersAtCutoff = await holdersAt(plan.cutoffBlock);
  const membersNow = await holdersAt(head.number);
  const thresholds = [0n, 5700_000000n, 18700_000000n, 62000_000000n];
  const eligible = [];
  for (const member of membersAtCutoff) {
    if (member.tier < 1 || member.tier > 3) throw new Error('Unknown NFT tier');
    const qualified = BigInt(member.lockedFGT) + BigInt(member.lockedFPT) >= thresholds[member.tier];
    if (qualified !== member.rewardEligible) throw new Error('NFT qualification flag disagrees with locked amount');
    member.excluded = await distributor.rewardExcluded(member.wallet, at);
    if (qualified && !member.excluded) eligible.push(member);
  }
  const legacy = await token.balanceOf(plan.legacyVault, at);
  const currentAvailable = await vault.unreservedBalance(plan.token, at);
  const currentReserved = await vault.reservedBalance(plan.token, at);
  const budget = legacy + currentAvailable;
  const tiers = [1, 2, 3].map((tier) => eligible.filter((member) => member.tier === tier)
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
    .map((member) => ({ ...member, leaf: rewardLeaf(member.wallet, tier) })));
  const trees = tiers.map(buildTree);
  const tierReports = tiers.map((members, i) => {
    const allocation = budget * BigInt([50, 30, 20][i]) / 100n;
    const perMember = members.length ? allocation / BigInt(members.length) : 0n;
    return { tier: i + 1, count: members.length, allocation: format(allocation), perMember: format(perMember),
      paidIfPublishedNow: format(perMember * BigInt(members.length)),
      retained: format(allocation - perMember * BigInt(members.length)),
      root: trees[i].root,
      members: members.map((member) => ({ ...member, amountRaw: perMember.toString(), amount: format(perMember),
        proof: trees[i].proofs.get(member.wallet) })) };
  });
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI,
    { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  if (db.databaseName !== 'finfreedom') throw new Error('Not the production database');
  const events = await db.collection('freedomplusevents').find({ chainId: 137,
    contractAddress: memberAddress.toLowerCase(), blockNumber: { $lte: plan.cutoffBlock },
    eventName: { $in: ['MembershipMinted', 'MembershipTierChanged', 'QualificationUnlocked', 'EligibilityRestored'] },
  }).sort({ blockNumber: 1, logIndex: 1 }).toArray();
  const replay = new Map();
  for (const event of events) {
    const a = event.args;
    const wallet = a.member.toLowerCase();
    const old = replay.get(wallet) || { wallet, tier: 0, rewardEligible: false };
    if (event.eventName === 'QualificationUnlocked') old.rewardEligible = Boolean(a.rewardEligible);
    else {
      old.tier = Number(event.eventName === 'MembershipTierChanged' ? a.newTier : a.tier);
      old.rewardEligible = true;
    }
    replay.set(wallet, old);
  }
  const canonical = (members) => members.map((m) => `${m.wallet}:${m.tier}:${m.rewardEligible}`).sort();
  const databaseMatchesCutoff = JSON.stringify(canonical([...replay.values()])) === JSON.stringify(canonical(membersAtCutoff));
  const jobs = await db.collection('nftrewarddistributionjobs').find({ chainId: 137,
    distributor: plan.distributor.toLowerCase() }, { projection: { _id: 0, leaseOwner: 0 } }).toArray();
  const period = await distributor.periodOf(1, at);
  const operator = await distributor.rewardOperator(at);
  const fees = await provider.getFeeData();
  const report = { checkedAt: new Date().toISOString(), chainId: 137, blockNumber: head.number,
    blockTime: new Date(head.timestamp * 1000).toISOString(), cutoffBlock: plan.cutoffBlock,
    cutoff: new Date(Number(times[1]) * 1000).toISOString(), distributionAt: new Date(Number(times[0]) * 1000).toISOString(),
    membership: memberAddress, distributor: plan.distributor, id1, operator,
    operatorPol: formatUnits(await provider.getBalance(operator, head.number), 18),
    fees: { maxFeePerGas: fees.maxFeePerGas?.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas?.toString() },
    fundingPolicy: 'All live unreserved pool funds at publication; only membership eligibility freezes at cutoff',
    currentAvailable: format(currentAvailable), currentReserved: format(currentReserved), legacy: format(legacy),
    combinedAvailable: format(budget), created: period.created, publishedPool: format(period.poolAmount),
    membersAtCutoff, membersNow, eligibleCount: eligible.length, tiers: tierReports,
    database: { name: db.databaseName, eventCount: events.length, matchesCutoff: databaseMatchesCutoff, jobs } };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/nft-cycle-1-eligibility-2026-11-02.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, membersAtCutoff: membersAtCutoff.length, membersNow: membersNow.length,
    tiers: tierReports.map(({ members, root, ...tier }) => tier) }, null, 2));
  if (!databaseMatchesCutoff) throw new Error('Database eligibility differs from pinned on-chain membership');
} catch (error) {
  console.error(String(error.shortMessage || error.message).replace(/https?:\/\/\S+/g, '[RPC]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  provider.destroy();
}
