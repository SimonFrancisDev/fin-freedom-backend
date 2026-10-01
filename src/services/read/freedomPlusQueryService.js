import { getAddress, ZeroAddress } from 'ethers';
import env from '../../config/env.js';
import { freedomPlusOrbitTypeForLevel } from '../../config/freedomPlusProgram.js';
import FreedomPlusEvent from '../../models/FreedomPlusEvent.js';
import FreedomPlusParticipant from '../../models/FreedomPlusParticipant.js';
import FreedomPlusLevelState from '../../models/FreedomPlusLevelState.js';
import FreedomPlusPosition from '../../models/FreedomPlusPosition.js';
import FreedomPlusPayment from '../../models/FreedomPlusPayment.js';
import FreedomPlusSyncState from '../../models/FreedomPlusSyncState.js';
import FreedomPlusLedgerEntry from '../../models/FreedomPlusLedgerEntry.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import ReferralCode from '../../models/ReferralCode.js';
import { getProvider } from '../../blockchain/provider.js';
import { getContracts } from '../../blockchain/contracts.js';
import {
  getFreedomPlusContractEntries,
  getFreedomPlusContracts,
} from '../../blockchain/freedomPlusContracts.js';
import {
  freedomPlusRewardProof,
  listFreedomPlusRewardPeriods,
} from '../freedomPlusRewardSnapshotService.js';

function wallet(value) {
  try { return getAddress(value).toLowerCase(); } catch { throw new Error('Invalid wallet address'); }
}

function pageOptions(query) {
  const limit = Math.min(200, Math.max(1, Number(query.limit || 50)));
  const page = Math.max(1, Number(query.page || 1));
  return { limit, skip: (page - 1) * limit, page };
}


export async function freedomPlusStatus() {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false, sync: [], participants: 0 };
  const [sync, participants, events] = await Promise.all([
    FreedomPlusSyncState.find({ chainId: env.CHAIN_ID }).sort({ contractKey: 1 }).lean(),
    FreedomPlusParticipant.countDocuments({ chainId: env.CHAIN_ID, registered: true }),
    FreedomPlusEvent.countDocuments({ chainId: env.CHAIN_ID }),
  ]);
  return { enabled: true, participants, events, sync };
}

export async function freedomPlusReconciliation() {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false, passed: false };
  const contracts = getFreedomPlusContracts();
  const provider = getProvider();
  const [head, chainParticipants, databaseParticipants, rawPositions, positions, rawPayments, payments, sync, latestEvent] = await Promise.all([
    provider.getBlockNumber(),
    contracts.registration.registeredCount(),
    FreedomPlusParticipant.countDocuments({ chainId: env.CHAIN_ID, registered: true }),
    FreedomPlusEvent.countDocuments({ chainId: env.CHAIN_ID, eventName: 'PositionRecorded' }),
    FreedomPlusPosition.countDocuments({ chainId: env.CHAIN_ID }),
    FreedomPlusEvent.countDocuments({ chainId: env.CHAIN_ID, eventName: { $in: ['ComponentSettled', 'FounderComponentSettled'] } }),
    FreedomPlusPayment.countDocuments({ chainId: env.CHAIN_ID }),
    FreedomPlusSyncState.find({ chainId: env.CHAIN_ID }).lean(),
    FreedomPlusEvent.findOne({ chainId: env.CHAIN_ID }).sort({ blockNumber: -1, logIndex: -1 }).select('blockNumber').lean(),
  ]);
  const confirmedHead = Math.max(0, head - env.SYNC_CONFIRMATIONS);
  const latestEventBlock = Number(latestEvent?.blockNumber || env.FREEDOM_PLUS_START_BLOCK || 0);
  const expectedCheckpointCount = getFreedomPlusContractEntries(provider).length;
  const minimumCheckpointBlock = sync.length
    ? Math.min(...sync.map((state) => Number(state.lastProcessedBlock || 0)))
    : 0;
  const checkpointLagBlocks = Math.max(0, confirmedHead - minimumCheckpointBlock);
  const checkpointFloor = Math.max(0, confirmedHead - env.FREEDOM_PLUS_MAX_CHECKPOINT_LAG_BLOCKS);
  const realtimeMode = env.FREEDOM_PLUS_REALTIME_ENABLED;
  const requiredCheckpointBlock = realtimeMode ? latestEventBlock : checkpointFloor;
  const checks = {
    participants: Number(chainParticipants) === databaseParticipants,
    positions: rawPositions === positions,
    payments: rawPayments === payments,
    checkpoints: sync.length === expectedCheckpointCount && sync.every(
      (state) => state.status !== 'error' && Number(state.lastProcessedBlock || 0) >= requiredCheckpointBlock
    ),
  };
  return {
    enabled: true,
    passed: Object.values(checks).every(Boolean),
    head,
    confirmedHead,
    latestEventBlock,
    checkpointMode: realtimeMode ? 'event-driven' : 'polling',
    requiredCheckpointBlock,
    checkpointFloor,
    checkpointLagBlocks,
    maxCheckpointLagBlocks: env.FREEDOM_PLUS_MAX_CHECKPOINT_LAG_BLOCKS,
    expectedCheckpointCount,
    actualCheckpointCount: sync.length,
    checks,
    totals: {
      chainParticipants: Number(chainParticipants),
      databaseParticipants,
      rawPositions,
      positions,
      rawPayments,
      payments,
    },
  };
}

async function freedomPlusNetwork(normalized) {
  const participants = await FreedomPlusParticipant.find({
    chainId: env.CHAIN_ID,
    registered: true,
  }).select('wallet sponsor participantNumber registeredAtBlock registeredAt').lean();

  const childrenBySponsor = new Map();
  for (const item of participants) {
    const sponsor = String(item.sponsor || '').toLowerCase();
    if (!sponsor) continue;
    const children = childrenBySponsor.get(sponsor) || [];
    children.push(item);
    childrenBySponsor.set(sponsor, children);
  }

  const directParticipants = childrenBySponsor.get(normalized) || [];
  const referralCodes = directParticipants.length
    ? await ReferralCode.find({
        walletAddress: { $in: directParticipants.map((item) => item.wallet) },
        isActive: true,
      }).select('walletAddress shortCode').lean()
    : [];
  const referralByWallet = new Map(
    referralCodes.map((item) => [String(item.walletAddress || '').toLowerCase(), item.shortCode])
  );

  const visited = new Set([normalized]);
  const queue = [...directParticipants];
  let totalTeam = 0;
  while (queue.length) {
    const member = queue.shift();
    const memberWallet = String(member?.wallet || '').toLowerCase();
    if (!memberWallet || visited.has(memberWallet)) continue;
    visited.add(memberWallet);
    totalTeam += 1;
    queue.push(...(childrenBySponsor.get(memberWallet) || []));
  }

  return {
    direct: directParticipants.length,
    totalTeam,
    directParticipants: directParticipants.map((item) => ({
      wallet: item.wallet,
      participantNumber: Number(item.participantNumber || 0),
      referralId: referralByWallet.get(String(item.wallet || '').toLowerCase()) || '',
      registeredAtBlock: Number(item.registeredAtBlock || 0),
      registeredAt: item.registeredAt || null,
    })),
  };
}
export async function freedomPlusParticipant(address) {
  const normalized = wallet(address);
  const [participant, levels, positions, payments, ledger, network, fFreedomRegistration, fFreedomLevelOne] = await Promise.all([
    FreedomPlusParticipant.findOne({ chainId: env.CHAIN_ID, wallet: normalized }).lean(),
    FreedomPlusLevelState.find({ chainId: env.CHAIN_ID, wallet: normalized }).sort({ level: 1 }).lean(),
    FreedomPlusPosition.find({ chainId: env.CHAIN_ID, participant: normalized })
      .sort({ blockNumber: -1, position: -1 }).limit(200).lean(),
    FreedomPlusPayment.find({ chainId: env.CHAIN_ID, recipient: normalized, distributedToFounders: { $ne: true } })
      .sort({ blockNumber: -1 }).limit(200).lean(),
    FreedomPlusLedgerEntry.find({ chainId: env.CHAIN_ID, wallet: normalized })
      .sort({ blockNumber: -1, logIndex: -1 }).limit(200).lean(),
    freedomPlusNetwork(normalized),
    IndexedRegistrationEvent.findOne({ chainId: env.CHAIN_ID, user: normalized, eventName: 'Registered' })
      .sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedRegistrationEvent.findOne({
      chainId: env.CHAIN_ID,
      user: normalized,
      eventName: { $in: ['Registered', 'LevelActivated', 'FounderRepActivated'] },
      $or: [{ level: 1 }, { eventName: 'Registered' }],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
  ]);
  let gatewayRegistered = Boolean(fFreedomRegistration);
  let gatewayLevelOneActive = Boolean(fFreedomLevelOne);
  let gatewaySponsor = fFreedomRegistration?.referrer || '';
  let gatewaySource = 'indexed';
  if (!gatewayRegistered || !gatewayLevelOneActive || !gatewaySponsor || gatewaySponsor.toLowerCase() === ZeroAddress) {
    try {
      const registration = getContracts().registration;
      const [registered, levelOneActive, sponsor, id1Wallet] = await Promise.all([
        registration.isRegistered(normalized), registration.isLevelActivated(normalized, 1), registration.getReferrer(normalized), getContracts().levelManager.id1Wallet(),
      ]);
      gatewayRegistered ||= Boolean(registered);
      gatewayLevelOneActive ||= Boolean(levelOneActive);
      const inheritedSponsor = sponsor && sponsor !== ZeroAddress ? sponsor : id1Wallet;
      if (inheritedSponsor && inheritedSponsor !== ZeroAddress && String(inheritedSponsor).toLowerCase() !== normalized) gatewaySponsor = String(inheritedSponsor).toLowerCase();
      gatewaySource = 'indexed+chain-fallback';
    } catch { gatewaySource = 'indexed-fallback-unavailable'; }
  }
  return {
    wallet: normalized,
    gateway: {
      registered: gatewayRegistered,
      levelOneActive: gatewayLevelOneActive,
      sponsor: gatewaySponsor,
      source: gatewaySource,
    },
    participant, levels, positions,
    payments: [...payments, ...ledger.filter((entry) => entry.category === 'founder_income').map(founderPayment)],
    ledger, network,
  };
}

export async function freedomPlusActivationSummary(address) {
  const normalized = wallet(address);
  const [participant, levels, positionGroups, latestWalletEvent, sync] = await Promise.all([
    FreedomPlusParticipant.findOne({ chainId: env.CHAIN_ID, wallet: normalized }).lean(),
    FreedomPlusLevelState.find({ chainId: env.CHAIN_ID, wallet: normalized }).sort({ level: 1 }).lean(),
    FreedomPlusPosition.aggregate([
      { $match: { chainId: env.CHAIN_ID, orbitOwner: normalized } },
      { $group: {
        _id: { level: '$level', cycle: '$cycle' },
        orbitType: { $first: '$orbitType' },
        filledPositions: { $sum: 1 },
        latestBlock: { $max: '$blockNumber' },
      } },
      { $sort: { '_id.level': 1, '_id.cycle': -1 } },
    ]),
    FreedomPlusEvent.findOne({ chainId: env.CHAIN_ID, addresses: normalized })
      .sort({ blockNumber: -1, logIndex: -1 }).select('blockNumber timestamp txHash eventName').lean(),
    FreedomPlusSyncState.find({ chainId: env.CHAIN_ID }).select('contractKey lastProcessedBlock status error').lean(),
  ]);

  const currentByLevel = new Map();
  for (const group of positionGroups) {
    const level = Number(group._id.level);
    if (!currentByLevel.has(level)) currentByLevel.set(level, group);
  }
  const indexedThrough = sync.length ? Math.min(...sync.map((item) => Number(item.lastProcessedBlock || 0))) : 0;

  return {
    wallet: normalized,
    participant,
    levels,
    orbitSummaries: Array.from({ length: 7 }, (_, index) => {
      const level = index + 1;
      const current = currentByLevel.get(level);
      return {
        level,
        orbitType: current?.orbitType || freedomPlusOrbitTypeForLevel(level),
        currentCycle: current ? Number(current._id.cycle) : 0,
        filledPositions: Number(current?.filledPositions || 0),
        latestBlock: Number(current?.latestBlock || 0),
      };
    }),
    sync: {
      indexedThrough,
      latestWalletEvent: latestWalletEvent || null,
      healthy: sync.length > 0 && sync.every((item) => item.status !== 'error'),
      errors: sync.filter((item) => item.status === 'error').map((item) => ({ contractKey: item.contractKey, error: item.error })),
    },
  };
}

export async function freedomPlusOrbit(address, level, query = {}) {
  const normalized = wallet(address);
  const numericLevel = Number(level);
  if (!Number.isInteger(numericLevel) || numericLevel < 1 || numericLevel > 7) {
    throw new Error('Invalid Freedom-Plus level');
  }
  const filter = { chainId: env.CHAIN_ID, orbitOwner: normalized, level: numericLevel };
  if (query.cycle !== undefined) filter.cycle = Number(query.cycle);
  const positions = await FreedomPlusPosition.find(filter).sort({ cycle: 1, position: 1 }).lean();
  const activationIds = [...new Set(positions.map((item) => item.activationId).filter(Boolean))];
  const participants = [...new Set(positions.map((item) => item.participant).filter(Boolean))];
  const registrations = participants.length ? await IndexedRegistrationEvent.find({ chainId: env.CHAIN_ID, user: { $in: participants }, eventName: 'Registered' }).sort({ blockNumber: 1, logIndex: 1 }).lean() : [];
  const payments = activationIds.length
    ? await FreedomPlusPayment.find({ chainId: env.CHAIN_ID, activationId: { $in: activationIds } })
      .sort({ activationId: 1, role: 1 }).lean()
    : [];
  const paymentsByActivation = new Map();
  for (const payment of payments) {
    const key = String(payment.activationId || '').toLowerCase();
    const current = paymentsByActivation.get(key) || [];
    current.push(payment);
    paymentsByActivation.set(key, current);
  }
  const referrerByParticipant = new Map();
  for (const registration of registrations) {
    const participant = String(registration.user || '').toLowerCase();
    if (participant && !referrerByParticipant.has(participant)) referrerByParticipant.set(participant, String(registration.referrer || '').toLowerCase());
  }
  return positions.map((position) => ({
    ...position,
    occupantReferrer: referrerByParticipant.get(String(position.participant || '').toLowerCase()) || '',
    relationship: String(position.participant || '').toLowerCase() === normalized ? 'owner' : referrerByParticipant.get(String(position.participant || '').toLowerCase()) === normalized ? 'direct' : 'indirect',
    payments: paymentsByActivation.get(String(position.activationId || '').toLowerCase()) || [],
    dataSource: 'indexed',
  }));
}

export async function freedomPlusPayments(address, query = {}) {
  const normalized = wallet(address);
  const { limit, skip, page } = pageOptions(query);
  const filter = { chainId: env.CHAIN_ID, recipient: normalized, distributedToFounders: { $ne: true } };
  if (query.level) filter.level = Number(query.level);
  const founderFilter = { chainId: env.CHAIN_ID, wallet: normalized, category: 'founder_income' };
  if (query.level) founderFilter.level = Number(query.level);
  const [ordinary, ordinaryCount, founders, founderCount] = await Promise.all([
    FreedomPlusPayment.find(filter).sort({ blockNumber: -1, _id: 1 }).limit(skip + limit).lean(),
    FreedomPlusPayment.countDocuments(filter),
    FreedomPlusLedgerEntry.find(founderFilter).sort({ blockNumber: -1, _id: 1 }).limit(skip + limit).lean(),
    FreedomPlusLedgerEntry.countDocuments(founderFilter),
  ]);
  const items = [...ordinary, ...founders.map(founderPayment)]
    .sort((a, b) => b.blockNumber - a.blockNumber || String(a._id).localeCompare(String(b._id)))
    .slice(skip, skip + limit);
  const total = ordinaryCount + founderCount;
  return { page, limit, total, items };
}

function founderPayment(entry) {
  return { ...entry, recipient: entry.wallet, role: Number(entry.details?.role || 0),
    bps: 1250, id1Fallback: false, founderDistribution: true };
}

export async function freedomPlusEvents(address, query = {}) {
  const normalized = wallet(address);
  const { limit, skip, page } = pageOptions(query);
  const filter = { chainId: env.CHAIN_ID, addresses: normalized };
  if (query.eventName) filter.eventName = String(query.eventName);
  const [items, total] = await Promise.all([
    FreedomPlusEvent.find(filter).sort({ blockNumber: -1, logIndex: -1 }).skip(skip).limit(limit).lean(),
    FreedomPlusEvent.countDocuments(filter),
  ]);
  return { page, limit, total, items };
}

export { freedomPlusRewardProof, listFreedomPlusRewardPeriods };

export async function freedomPlusDashboard(address) {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false };
  const normalized = wallet(address);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 6);
  since.setUTCHours(0, 0, 0, 0);

  const [profile, participants, payments, systemLedger, registrations, recentEvents, sync] = await Promise.all([
    freedomPlusParticipant(normalized),
    FreedomPlusParticipant.countDocuments({ chainId: env.CHAIN_ID, registered: true }),
    FreedomPlusPayment.find({ chainId: env.CHAIN_ID }).select('amount').lean(),
    FreedomPlusLedgerEntry.find({
      chainId: env.CHAIN_ID,
      category: { $in: ['system_charge', 'nft_membership', 'nft_claim'] },
    }).select('category amount eventName').lean(),
    FreedomPlusParticipant.find({
      chainId: env.CHAIN_ID,
      registered: true,
      registeredAt: { $gte: since },
    }).select('registeredAt').lean(),
    FreedomPlusEvent.find({ chainId: env.CHAIN_ID })
      .sort({ blockNumber: -1, logIndex: -1 })
      .limit(20)
      .select('eventName txHash blockNumber timestamp contractKey args')
      .lean(),
    FreedomPlusSyncState.find({ chainId: env.CHAIN_ID }).sort({ contractKey: 1 }).lean(),
  ]);

  const sumRaw = (items) => items.reduce((sum, item) => sum + BigInt(item.amount || 0), 0n).toString();
  const paymentTotal = sumRaw(payments);
  const systemCharges = systemLedger.filter((item) => item.category === 'system_charge');
  const nftInflow = systemLedger.filter((item) => item.category === 'nft_membership');
  const nftClaims = systemLedger.filter((item) => item.category === 'nft_claim');
  const growthByDate = new Map();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(since);
    date.setUTCDate(since.getUTCDate() + offset);
    growthByDate.set(date.toISOString().slice(0, 10), 0);
  }
  for (const item of registrations) {
    const key = item.registeredAt?.toISOString?.().slice(0, 10);
    if (key && growthByDate.has(key)) growthByDate.set(key, growthByDate.get(key) + 1);
  }

  return {
    enabled: true,
    profile,
    totals: {
      participants,
      paymentComponents: payments.length,
      walletCreditedRaw: paymentTotal,
      systemChargesRaw: sumRaw(systemCharges),
      nftInflowRaw: sumRaw(nftInflow),
      nftDistributedRaw: sumRaw(nftClaims),
    },
    growth: [...growthByDate].map(([date, count]) => ({ date, registrations: count })),
    recentEvents,
    sync,
  };
}
