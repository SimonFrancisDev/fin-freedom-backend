import 'dotenv/config';
import mongoose from 'mongoose';
import IndexedActivationSummary from '../src/models/IndexedActivationSummary.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import { buildOrbitLevelSnapshot } from '../src/services/snapshots/orbitLevelSnapshotBuilder.js';

const chainId = Number(process.env.CHAIN_ID || 0);
const shouldApply = process.argv.includes('--apply');
const levelKey = (address, level) =>
  `${String(address || '').toLowerCase()}:${Number(level || 0)}`;

function compareChainPoint(a, b) {
  const blockDiff = Number(a?.blockNumber || 0) - Number(b?.blockNumber || 0);
  if (blockDiff !== 0) return blockDiff;
  return Number(a?.logIndex || 0) - Number(b?.logIndex || 0);
}

function currentPositionEvents(rows, snapshot) {
  const resetEvents = rows
    .filter((row) => row.eventName === 'OrbitReset')
    .sort(compareChainPoint);
  const lastReset = resetEvents.at(-1) || null;
  const completedCycles = Math.max(
    Number(snapshot?.orbitSummary?.totalCycles || 0),
    ...resetEvents.map((row) => Number(row.cycleNumber || 0)),
    0
  );
  const currentCycle = completedCycles + 1;
  const latestByPosition = new Map();

  for (const row of rows.sort(compareChainPoint)) {
    if (row.eventName !== 'PositionFilled') continue;
    if (lastReset && compareChainPoint(row, lastReset) <= 0) continue;
    const cycle = Number(row.cycleNumber || 0);
    if (cycle !== 0 && cycle !== currentCycle) continue;
    latestByPosition.set(Number(row.position || 0), row);
  }

  return [...latestByPosition.values()];
}

function addTarget(targets, address, level, reason, blockNumber = 0) {
  const normalized = String(address || '').toLowerCase();
  const numericLevel = Number(level || 0);
  if (!normalized || numericLevel < 1 || numericLevel > 10) return;
  const key = levelKey(normalized, numericLevel);
  const existing = targets.get(key) || {
    address: normalized,
    level: numericLevel,
    reasons: new Set(),
    freshnessBlock: 0,
  };
  existing.reasons.add(reason);
  existing.freshnessBlock = Math.max(
    existing.freshnessBlock,
    Number(blockNumber || 0)
  );
  targets.set(key, existing);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!chainId) throw new Error('CHAIN_ID is required');

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 60000,
  });

  const [registration, activations, orbitEvents, receipts, snapshots] =
    await Promise.all([
      IndexedRegistrationEvent.find({ chainId }).lean(),
      IndexedActivationSummary.find({ chainId }).lean(),
      IndexedOrbitEvent.find({ chainId }).sort({ blockNumber: 1, logIndex: 1 }).lean(),
      IndexedReceipt.find({ chainId }).lean(),
      OrbitLevelSnapshot.find({}).lean(),
    ]);

  const snapshotsByKey = new Map(
    snapshots.map((row) => [levelKey(row.address, row.level), row])
  );
  const orbitEventsByKey = new Map();
  const latestBlockByKey = new Map();
  const targets = new Map();

  for (const row of orbitEvents) {
    if (!row.orbitOwner || !row.level) continue;
    const key = levelKey(row.orbitOwner, row.level);
    if (!orbitEventsByKey.has(key)) orbitEventsByKey.set(key, []);
    orbitEventsByKey.get(key).push(row);
    latestBlockByKey.set(
      key,
      Math.max(latestBlockByKey.get(key) || 0, Number(row.blockNumber || 0))
    );
  }

  for (const row of receipts) {
    if (!row.orbitOwner || !row.level) continue;
    const key = levelKey(row.orbitOwner, row.level);
    latestBlockByKey.set(
      key,
      Math.max(latestBlockByKey.get(key) || 0, Number(row.blockNumber || 0))
    );
  }

  for (const row of registration) {
    if (!row.user) continue;
    const level = Number(
      row.level || (row.eventName === 'Registered' ? 1 : 0)
    );
    if (level && !snapshotsByKey.has(levelKey(row.user, level))) {
      addTarget(
        targets,
        row.user,
        level,
        'missing-activated-level-snapshot',
        row.blockNumber
      );
    }
  }

  for (const row of activations) {
    if (
      row.user &&
      row.level &&
      !snapshotsByKey.has(levelKey(row.user, row.level))
    ) {
      addTarget(
        targets,
        row.user,
        row.level,
        'missing-activation-summary-snapshot',
        row.blockNumber
      );
    }
  }

  for (const [key, rows] of orbitEventsByKey) {
    const [address, rawLevel] = key.split(':');
    const level = Number(rawLevel);
    const snapshot = snapshotsByKey.get(key);
    if (!snapshot) {
      addTarget(
        targets,
        address,
        level,
        'missing-orbit-owner-snapshot',
        latestBlockByKey.get(key)
      );
      continue;
    }

    for (const event of currentPositionEvents(rows, snapshot)) {
      const position = (snapshot.positions || []).find(
        (item) => Number(item.number || 0) === Number(event.position || 0)
      );
      if (
        !position?.occupant ||
        String(position.occupant).toLowerCase() !==
          String(event.user || '').toLowerCase()
      ) {
        addTarget(
          targets,
          address,
          level,
          'current-placement-mismatch',
          latestBlockByKey.get(key)
        );
        break;
      }
    }
  }

  const targetList = [...targets.values()]
    .map((target) => ({
      ...target,
      reasons: [...target.reasons].sort(),
      freshnessBlock: Math.max(
        target.freshnessBlock,
        latestBlockByKey.get(levelKey(target.address, target.level)) || 0
      ),
    }))
    .sort((a, b) =>
      a.address.localeCompare(b.address) || a.level - b.level
    );

  console.log(JSON.stringify({
    mode: shouldApply ? 'apply' : 'dry-run',
    chainId,
    indexedRegistrations: registration.filter(
      (row) => row.eventName === 'Registered'
    ).length,
    snapshots: snapshots.length,
    targets: targetList.length,
    reasons: targetList.reduce((summary, target) => {
      for (const reason of target.reasons) {
        summary[reason] = (summary[reason] || 0) + 1;
      }
      return summary;
    }, {}),
  }, null, 2));

  if (!shouldApply) return;

  let completed = 0;
  for (const target of targetList) {
    await buildOrbitLevelSnapshot(target.address, target.level, {
      builtFromBlock: target.freshnessBlock,
      freshnessBlock: target.freshnessBlock,
    });
    completed += 1;
    if (completed % 10 === 0 || completed === targetList.length) {
      console.log(`[SNAPSHOT_RECONCILIATION_PROGRESS] ${completed}/${targetList.length}`);
    }
    await sleep(100);
  }

  console.log(JSON.stringify({
    mode: 'apply-complete',
    chainId,
    rebuilt: completed,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
