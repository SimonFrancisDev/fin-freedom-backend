import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import ReferralCode from '../src/models/ReferralCode.js';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedActivationSummary from '../src/models/IndexedActivationSummary.js';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';
import IndexedEscrowEvent from '../src/models/IndexedEscrowEvent.js';
import IndexedTokenEvent from '../src/models/IndexedTokenEvent.js';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import OrbitCycleSnapshot from '../src/models/OrbitCycleSnapshot.js';

const wallets = {
  wp98hbOld: '0xc0545331e20587208d4b27b2a3e4920cc481133a',
  wp98hbNew: '0x1ea5513e017b4e25847e91abc84ac8686331f80b',
  rymqk4Old: '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba',
  rymqk4New: '0xfb8d46674f51882baaa2c9606122484434ff2dc2',
};

const lower = (value) => String(value || '').toLowerCase();
const unique = (values) => [...new Set(values.map(lower).filter(Boolean))];

function buildDescendants(registeredEvents, root) {
  const children = new Map();
  for (const event of registeredEvents) {
    const parent = lower(event.referrer);
    const child = lower(event.user);
    if (!parent || !child) continue;
    const rows = children.get(parent) || [];
    if (!rows.includes(child)) rows.push(child);
    children.set(parent, rows);
  }

  const generations = [];
  const visited = new Set([root]);
  let frontier = [...(children.get(root) || [])];
  while (frontier.length) {
    const generation = unique(frontier).filter((address) => !visited.has(address));
    if (!generation.length) break;
    generation.forEach((address) => visited.add(address));
    generations.push(generation);
    frontier = generation.flatMap((address) => children.get(address) || []);
  }

  return {
    direct: generations[0] || [],
    generations,
    indirect: generations.slice(1).flat(),
    totalDescendants: generations.flat().length,
  };
}

function compactEvents(rows) {
  return rows.map((row) => ({
    eventName: row.eventName,
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    user: row.user,
    referrer: row.referrer,
    orbitOwner: row.orbitOwner,
    receiver: row.receiver,
    fromUser: row.fromUser,
    actualReceiver: row.actualReceiver,
    affectedUser: row.affectedUser,
    recycleReceiver: row.recycleReceiver,
    level: row.level,
    position: row.position,
    cycleNumber: row.cycleNumber,
    sourcePosition: row.sourcePosition,
    sourceCycle: row.sourceCycle,
    amount: row.amount,
    grossAmount: row.grossAmount,
    liquidPaid: row.liquidPaid,
    escrowLocked: row.escrowLocked,
    timestamp: row.timestamp,
  }));
}

async function inventory(label, address, allRegistrations) {
  const addressFilter = { $eq: address };
  const [
    referral,
    registrationEvents,
    orbitEvents,
    receipts,
    activationSummaries,
    financialEvents,
    escrowEvents,
    tokenEvents,
    ownedSnapshots,
    occupiedSnapshots,
    historicalOccupiedSnapshots,
  ] = await Promise.all([
    ReferralCode.findOne({ walletAddress: address }).lean(),
    IndexedRegistrationEvent.find({
      $or: [{ user: addressFilter }, { referrer: addressFilter }],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedOrbitEvent.find({
      $or: [{ user: addressFilter }, { orbitOwner: addressFilter }],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedReceipt.find({
      $or: [
        { receiver: addressFilter },
        { fromUser: addressFilter },
        { orbitOwner: addressFilter },
      ],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedActivationSummary.find({ user: address }).sort({ blockNumber: 1 }).lean(),
    IndexedFinancialEvent.find({
      $or: [
        { user: addressFilter },
        { sourceUser: addressFilter },
        { affectedUser: addressFilter },
        { actualReceiver: addressFilter },
        { orbitOwner: addressFilter },
        { recycleReceiver: addressFilter },
        { founderWallet: addressFilter },
      ],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedEscrowEvent.find({
      $or: [{ user: addressFilter }, { recipient: addressFilter }],
    }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    IndexedTokenEvent.find({ userAddress: address }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
    OrbitLevelSnapshot.find({ address }).lean(),
    OrbitLevelSnapshot.find({ 'positions.occupant': address }).lean(),
    OrbitCycleSnapshot.find({ 'positions.occupant': address }).lean(),
  ]);

  const registered = allRegistrations.find(
    (row) => row.eventName === 'Registered' && lower(row.user) === address
  );
  const levels = unique(
    allRegistrations
      .filter((row) => row.eventName === 'LevelActivated' && lower(row.user) === address)
      .map((row) => String(row.level))
  ).map(Number).sort((a, b) => a - b);

  return {
    label,
    address,
    referralCode: referral?.shortCode || null,
    referralRecordActive: referral?.isActive ?? null,
    registeredEvent: registered ? compactEvents([registered])[0] : null,
    sponsor: lower(registered?.referrer),
    activatedLevelsFromEvents: levels,
    descendants: buildDescendants(allRegistrations.filter((row) => row.eventName === 'Registered'), address),
    counts: {
      registrationEvents: registrationEvents.length,
      orbitEvents: orbitEvents.length,
      receipts: receipts.length,
      activationSummaries: activationSummaries.length,
      financialEvents: financialEvents.length,
      escrowEvents: escrowEvents.length,
      tokenEvents: tokenEvents.length,
      ownedLevelSnapshots: ownedSnapshots.length,
      occupiedCurrentSnapshots: occupiedSnapshots.length,
      occupiedHistoricalSnapshots: historicalOccupiedSnapshots.length,
    },
    registrationEvents: compactEvents(registrationEvents),
    orbitEvents: compactEvents(orbitEvents),
    receipts: compactEvents(receipts),
    activationSummaries: compactEvents(activationSummaries),
    financialEvents: compactEvents(financialEvents),
    escrowEvents: compactEvents(escrowEvents),
    tokenEvents: tokenEvents.map((row) => ({
      tokenSymbol: row.tokenSymbol,
      eventName: row.eventName,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      amount: row.amount,
      reason: row.reason,
      level: row.level,
      timestamp: row.timestamp,
    })),
    ownedSnapshots: ownedSnapshots.map((row) => ({
      orbitType: row.orbitType,
      level: row.level,
      currentPosition: row.orbitSummary?.currentPosition,
      totalCycles: row.orbitSummary?.totalCycles,
      lockedForNextLevel: row.lockedForNextLevel,
      filledPositions: (row.positions || []).filter((position) => position.occupant).length,
    })),
    currentOccurrences: occupiedSnapshots.flatMap((row) =>
      (row.positions || [])
        .filter((position) => lower(position.occupant) === address)
        .map((position) => ({
          orbitOwner: row.address,
          orbitType: row.orbitType,
          level: row.level,
          cycle: Number(row.orbitSummary?.totalCycles || 0) + 1,
          position: position.number,
          line: position.line,
          parentPosition: position.parentPosition,
          activationId: position.activationId,
          isMirror: position.isMirrorActivation,
        }))
    ),
    historicalOccurrences: historicalOccupiedSnapshots.flatMap((row) =>
      (row.positions || [])
        .filter((position) => lower(position.occupant) === address)
        .map((position) => ({
          orbitOwner: row.address,
          orbitType: row.orbitType,
          level: row.level,
          cycle: row.cycleNumber,
          position: position.number,
          line: position.line,
          parentPosition: position.parentPosition,
          activationId: position.activationId,
          isMirror: position.isMirrorActivation,
        }))
    ),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: 'finfreedom',
    autoIndex: false,
    serverSelectionTimeoutMS: 60000,
  });
  const allRegistrations = await IndexedRegistrationEvent.find({ chainId: 137 })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
  const result = {};
  for (const [label, address] of Object.entries(wallets)) {
    result[label] = await inventory(label, address, allRegistrations);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    database: mongoose.connection.name,
    wallets: result,
  };
  await mkdir('migration-audits', { recursive: true });
  const output = 'migration-audits/wallet-migration-inventory-91313968.json';
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output,
    wallets: Object.fromEntries(Object.entries(result).map(([label, row]) => [label, {
      address: row.address,
      referralCode: row.referralCode,
      sponsor: row.sponsor,
      levels: row.activatedLevelsFromEvents,
      directDownlines: row.descendants.direct.length,
      indirectDownlines: row.descendants.indirect.length,
      totalDescendants: row.descendants.totalDescendants,
      counts: row.counts,
      currentOccurrences: row.currentOccurrences.length,
      historicalOccurrences: row.historicalOccurrences.length,
    }])),
  }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
