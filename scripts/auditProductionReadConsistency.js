import 'dotenv/config';
import mongoose from 'mongoose';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedActivationSummary from '../src/models/IndexedActivationSummary.js';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';
import IndexedEscrowEvent from '../src/models/IndexedEscrowEvent.js';
import IndexedTokenEvent from '../src/models/IndexedTokenEvent.js';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import OrbitCycleSnapshot from '../src/models/OrbitCycleSnapshot.js';

const chainId = Number(process.env.CHAIN_ID || 137);
const keyOf = (row) => `${String(row.txHash || '').toLowerCase()}:${Number(row.logIndex || 0)}`;
const levelKey = (address, level) => `${String(address || '').toLowerCase()}:${Number(level || 0)}`;

function duplicateKeys(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

function maxBlock(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.blockNumber || 0)), 0);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const [registration, orbitEvents, receipts, activations, financial, escrow, tokens, levelSnapshots, cycleSnapshots] = await Promise.all([
    IndexedRegistrationEvent.find({ chainId }).lean(),
    IndexedOrbitEvent.find({ chainId }).lean(),
    IndexedReceipt.find({ chainId }).lean(),
    IndexedActivationSummary.find({ chainId }).lean(),
    IndexedFinancialEvent.find({ chainId }).lean(),
    IndexedEscrowEvent.find({ chainId }).lean(),
    IndexedTokenEvent.find({ chainId }).lean(),
    OrbitLevelSnapshot.find({}).lean(),
    OrbitCycleSnapshot.find({}).lean(),
  ]);

  const positionEvents = orbitEvents.filter((row) => row.eventName === 'PositionFilled');
  const positionByLevel = new Map();
  for (const row of positionEvents) {
    const key = levelKey(row.orbitOwner, row.level);
    if (!positionByLevel.has(key)) positionByLevel.set(key, []);
    positionByLevel.get(key).push(row);
  }

  const snapshotByLevel = new Map(levelSnapshots.map((row) => [levelKey(row.address, row.level), row]));
  const internalMismatches = [];
  const eventMismatches = [];
  for (const snapshot of levelSnapshots) {
    const positions = snapshot.positions || [];
    const occupied = positions.filter((row) => row.occupant);
    const lineTotal = Number(snapshot.orbitSummary?.positionsInLine1 || 0)
      + Number(snapshot.orbitSummary?.positionsInLine2 || 0)
      + Number(snapshot.orbitSummary?.positionsInLine3 || 0);
    const paymentTotal = Number(snapshot.linePaymentCounts?.line1 || 0)
      + Number(snapshot.linePaymentCounts?.line2 || 0)
      + Number(snapshot.linePaymentCounts?.line3 || 0);
    const currentPosition = Number(snapshot.orbitSummary?.currentPosition || 0);
    const pointerExpectedOccupied = Math.max(0, currentPosition - 1);
    if (occupied.length !== lineTotal || occupied.length !== pointerExpectedOccupied) {
      internalMismatches.push({
        address: snapshot.address,
        level: snapshot.level,
        orbitType: snapshot.orbitType,
        currentPosition,
        occupied: occupied.length,
        lineTotal,
        paymentTotal,
        pointerExpectedOccupied,
        updatedAt: snapshot.updatedAt,
      });
    }

    const currentCycle = Number(snapshot.orbitSummary?.totalCycles || 0) + 1;
    const events = (positionByLevel.get(levelKey(snapshot.address, snapshot.level)) || [])
      .filter((row) => !Number(row.cycleNumber || 0) || Number(row.cycleNumber) === currentCycle);
    for (const event of events) {
      const candidate = positions.find((row) => Number(row.number) === Number(event.position));
      if (!candidate || !candidate.occupant) {
        eventMismatches.push({
          address: snapshot.address,
          level: snapshot.level,
          position: event.position,
          cycle: Number(event.cycleNumber || 0),
          chainIndexedOccupant: event.user,
          snapshotOccupant: candidate?.occupant || null,
          eventBlock: event.blockNumber,
          reason: 'CURRENT_CYCLE_EVENT_MISSING_FROM_SNAPSHOT',
        });
        continue;
      }
      const snapshotCycle = Number(candidate.activationCycleNumber || 0);
      const eventCycle = Number(event.cycleNumber || 0);
      if (snapshotCycle && eventCycle && snapshotCycle !== eventCycle) continue;
      if (String(candidate.occupant).toLowerCase() !== String(event.user).toLowerCase()) {
        eventMismatches.push({
          address: snapshot.address,
          level: snapshot.level,
          position: event.position,
          cycle: eventCycle,
          chainIndexedOccupant: event.user,
          snapshotOccupant: candidate.occupant,
          eventBlock: event.blockNumber,
        });
      }
    }
  }

  const registeredUsers = new Set(registration.filter((row) => row.eventName === 'Registered').map((row) => row.user).filter(Boolean));
  const activatedUsers = new Set(registration.filter((row) => row.eventName === 'LevelActivated').map((row) => row.user).filter(Boolean));
  const missingLevelOneSnapshots = [...registeredUsers].filter((address) => !snapshotByLevel.has(levelKey(address, 1)));
  const activationIds = new Set(activations.map((row) => String(row.activationId || '')).filter(Boolean));
  const receiptActivationIds = new Set(receipts.map((row) => String(row.activationId || '')).filter(Boolean));
  const missingReceiptActivations = [...activationIds].filter((id) => id !== '0' && !receiptActivationIds.has(id));
  const affectedSnapshotKeys = new Set(eventMismatches.map((row) => levelKey(row.address, row.level)));
  const affectedByOrbit = {};
  const affectedByLevel = {};
  for (const key of affectedSnapshotKeys) {
    const snapshot = snapshotByLevel.get(key);
    const orbitType = snapshot?.orbitType || 'UNKNOWN';
    const level = String(snapshot?.level || key.split(':').at(-1));
    affectedByOrbit[orbitType] = (affectedByOrbit[orbitType] || 0) + 1;
    affectedByLevel[level] = (affectedByLevel[level] || 0) + 1;
  }

  const collections = { registration, orbitEvents, receipts, activations, financial, escrow, tokens };
  const duplicates = Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, duplicateKeys(rows)]));

  console.log(JSON.stringify({
    chainId,
    database: mongoose.connection.name,
    totals: {
      registeredUsers: registeredUsers.size,
      activatedUsers: activatedUsers.size,
      registrationEvents: registration.length,
      orbitEvents: orbitEvents.length,
      positionFilledEvents: positionEvents.length,
      receipts: receipts.length,
      activationSummaries: activations.length,
      financialEvents: financial.length,
      escrowEvents: escrow.length,
      tokenEvents: tokens.length,
      levelSnapshots: levelSnapshots.length,
      cycleSnapshots: cycleSnapshots.length,
    },
    maxBlocks: Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, maxBlock(rows)])),
    duplicates: Object.fromEntries(Object.entries(duplicates).map(([name, rows]) => [name, { count: rows.length, sample: rows.slice(0, 20) }])),
    coverage: {
      missingLevelOneSnapshotCount: missingLevelOneSnapshots.length,
      missingLevelOneSnapshots,
      activationIdsWithoutReceiptCount: missingReceiptActivations.length,
      activationIdsWithoutReceipt: missingReceiptActivations.slice(0, 100),
    },
    snapshotConsistency: {
      internalMismatchCount: internalMismatches.length,
      internalMismatches: internalMismatches.slice(0, 20),
      eventOccupantMismatchCount: eventMismatches.length,
      affectedSnapshotCount: affectedSnapshotKeys.size,
      affectedByOrbit,
      affectedByLevel,
      earliestMissingEventBlock: eventMismatches.length ? Math.min(...eventMismatches.map((row) => Number(row.eventBlock || 0))) : 0,
      latestMissingEventBlock: eventMismatches.length ? Math.max(...eventMismatches.map((row) => Number(row.eventBlock || 0))) : 0,
      snapshotsWithoutFreshnessBlock: levelSnapshots.filter((row) => !Number(row.metadata?.freshnessBlock || 0)).length,
      eventOccupantMismatches: eventMismatches.slice(0, 20),
    },
  }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
