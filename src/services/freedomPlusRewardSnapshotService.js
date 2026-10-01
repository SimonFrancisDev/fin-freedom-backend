import { ZeroHash, getAddress } from 'ethers';
import env from '../config/env.js';
import { getProvider } from '../blockchain/provider.js';
import FreedomPlusEvent from '../models/FreedomPlusEvent.js';
import FreedomPlusRewardSnapshot from '../models/FreedomPlusRewardSnapshot.js';
import FreedomPlusSyncState from '../models/FreedomPlusSyncState.js';
import { buildTree, rewardLeaf } from './freedomPlusMerkle.js';
import { syncNftMembershipThrough } from './freedomPlusIndexerService.js';

const MEMBERSHIP_EVENTS = [
  'MembershipMinted',
  'MembershipTierChanged',
  'QualificationUnlocked',
  'EligibilityRestored',
];

function periodDate(year, month) {
  if (!Number.isInteger(year) || year < 1970 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Invalid Freedom NFT reward year or month');
  }
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

async function cutoffBlockFor(provider, cutoffSeconds) {
  let low = Math.max(0, Number(env.FREEDOM_PLUS_START_BLOCK));
  let high = await provider.getBlockNumber();
  const highBlock = await provider.getBlock(high);
  if (!highBlock || Number(highBlock.timestamp) < cutoffSeconds) {
    throw new Error('Reward cutoff is later than the current chain head');
  }
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = await provider.getBlock(middle);
    if (!block) throw new Error(`Unable to read block ${middle} while resolving reward cutoff`);
    if (Number(block.timestamp) < cutoffSeconds) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function applyMembershipEvent(state, event) {
  const args = event.args || {};
  const wallet = String(args.member || '').toLowerCase();
  if (!wallet) return;
  const current = state.get(wallet) || { wallet, tier: 0, rewardEligible: false };
  if (event.eventName === 'MembershipMinted') {
    current.tier = Number(args.tier);
    current.rewardEligible = true;
  } else if (event.eventName === 'MembershipTierChanged') {
    current.tier = Number(args.newTier);
    current.rewardEligible = true;
  } else if (event.eventName === 'QualificationUnlocked') {
    current.rewardEligible = Boolean(args.rewardEligible);
  } else if (event.eventName === 'EligibilityRestored') {
    current.tier = Number(args.tier);
    current.rewardEligible = true;
  }
  state.set(wallet, current);
}

export async function buildFreedomPlusRewardSnapshot({ year, month }) {
  if (!env.FREEDOM_PLUS_ENABLED) throw new Error('Freedom-Plus is disabled');
  const cutoff = periodDate(Number(year), Number(month));
  if (cutoff.getTime() > Date.now()) throw new Error('Cannot build a future reward snapshot');
  const periodId = Number(year) * 100 + Number(month);
  const existing = await FreedomPlusRewardSnapshot.findOne({ chainId: env.CHAIN_ID, periodId }).lean();
  if (existing) {
    if (existing.membershipAddress !== env.FREEDOM_NFT_MEMBERSHIP_ADDRESS.toLowerCase()
        || existing.proofDataAvailable !== true) {
      throw new Error('Reward snapshot belongs to an unverified deployment or lacks proofs');
    }
    return existing;
  }
  const provider = getProvider();
  const cutoffBlock = await cutoffBlockFor(provider, Math.floor(cutoff.getTime() / 1000));
  if (cutoffBlock < Number(env.FREEDOM_PLUS_START_BLOCK)) {
    throw new Error('NFT reward cutoff precedes this deployment');
  }
  if ((await provider.getBlockNumber()) - env.SYNC_CONFIRMATIONS < cutoffBlock) {
    throw new Error('NFT cutoff block is not confirmed yet');
  }
  let checkpoints = await FreedomPlusSyncState.find({ chainId: env.CHAIN_ID, contractKey: 'nftMembership' }).lean();
  if (!checkpoints.length || checkpoints.some((item) => item.lastProcessedBlock < cutoffBlock)) {
    await syncNftMembershipThrough(cutoffBlock);
    checkpoints = await FreedomPlusSyncState.find({ chainId: env.CHAIN_ID, contractKey: 'nftMembership' }).lean();
  }
  if (!checkpoints.length || checkpoints.some((item) => item.status === 'error' || item.lastProcessedBlock < cutoffBlock)) {
    throw new Error(`Freedom-Plus index is not reconciled through cutoff block ${cutoffBlock}`);
  }
  const events = await FreedomPlusEvent.find({
    chainId: env.CHAIN_ID,
    contractKey: 'nftMembership',
    contractAddress: env.FREEDOM_NFT_MEMBERSHIP_ADDRESS.toLowerCase(),
    eventName: { $in: MEMBERSHIP_EVENTS },
    blockNumber: { $lte: cutoffBlock },
  }).sort({ blockNumber: 1, logIndex: 1 }).lean();
  const state = new Map();
  events.forEach((event) => applyMembershipEvent(state, event));
  const tiers = [1, 2, 3].map((tier) => [...state.values()]
    .filter((member) => member.tier === tier && member.rewardEligible)
    .map((member) => ({ wallet: getAddress(member.wallet).toLowerCase(), tier }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
    .map((member) => ({ ...member, leaf: rewardLeaf(member.wallet, tier) })));
  const trees = tiers.map(buildTree);
  const eligibility = tiers.flatMap((entries, index) => entries.map((entry) => ({
    ...entry,
    proof: trees[index].proofs.get(entry.wallet) || [],
  })));
  const snapshot = {
    chainId: env.CHAIN_ID,
    periodId,
    membershipAddress: env.FREEDOM_NFT_MEMBERSHIP_ADDRESS.toLowerCase(),
    year: Number(year),
    month: Number(month),
    cutoff,
    cutoffBlock,
    roots: trees.map((tree) => tree.root),
    counts: tiers.map((entries) => entries.length),
    eligibility,
    sourceEventCount: events.length,
    proofDataAvailable: true,
    status: 'draft',
    publishedTxHash: '',
  };
  const saved = await FreedomPlusRewardSnapshot.findOneAndUpdate(
    { chainId: env.CHAIN_ID, periodId },
    { $setOnInsert: snapshot },
    { upsert: true, new: true }
  ).lean();
  if (saved.membershipAddress !== snapshot.membershipAddress) {
    throw new Error('Reward snapshot belongs to an unverified or different membership deployment');
  }
  return saved;
}

export async function freedomPlusRewardProof(periodId, address) {
  const numericPeriod = Number(periodId);
  const wallet = getAddress(address).toLowerCase();
  const snapshot = await FreedomPlusRewardSnapshot.findOne({ chainId: env.CHAIN_ID, periodId: numericPeriod }).lean();
  if (!snapshot || snapshot.proofDataAvailable === false) {
    return { periodId: numericPeriod, wallet, snapshotAvailable: false, eligible: false };
  }
  const entry = snapshot.eligibility.find((item) => item.wallet === wallet);
  return {
    periodId: numericPeriod,
    wallet,
    snapshotAvailable: true,
    published: snapshot.status === 'published',
    cutoff: snapshot.cutoff,
    cutoffBlock: snapshot.cutoffBlock,
    eligible: Boolean(entry),
    tier: entry?.tier || 0,
    proof: entry?.proof || [],
    root: entry ? snapshot.roots[entry.tier - 1] : ZeroHash,
  };
}

export async function listFreedomPlusRewardPeriods() {
  return FreedomPlusRewardSnapshot.find({ chainId: env.CHAIN_ID })
    .select('-eligibility').sort({ periodId: -1 }).lean();
}
