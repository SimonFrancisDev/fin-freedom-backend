import 'dotenv/config';
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import OrbitCycleSnapshot from '../src/models/OrbitCycleSnapshot.js';

function normalize(address) {
  return String(address || '').toLowerCase();
}

function occurrenceKey(orbitType, level, occupant) {
  return `${orbitType}:${level}:${normalize(occupant)}`;
}

function addCycleOccurrences(target, snapshot, cycleNumber, source) {
  const positions = (snapshot.positions || []).filter((position) => position.occupant);
  const byNumber = new Map(positions.map((position) => [Number(position.number), position]));

  for (const position of positions) {
    const positionNumber = Number(position.number);
    let parent = '';
    let unresolvedReason = '';

    if (positionNumber <= 3) {
      parent = normalize(snapshot.address);
    } else {
      const parentPosition = Number(position.parentPosition || 0);
      const parentEntry = byNumber.get(parentPosition);
      parent = normalize(parentEntry?.occupant);
      if (!parentPosition) unresolvedReason = 'MISSING_PARENT_POSITION_NUMBER';
      else if (!parent) unresolvedReason = 'PARENT_POSITION_UNOCCUPIED';
    }

    const occupant = normalize(position.occupant);
    target.push({
      key: occurrenceKey(snapshot.orbitType, snapshot.level, occupant),
      orbitType: snapshot.orbitType,
      level: Number(snapshot.level),
      occupant,
      parent,
      orbitOwner: normalize(snapshot.address),
      cycleNumber: Number(cycleNumber),
      position: positionNumber,
      parentPosition: Number(position.parentPosition || 0),
      timestamp: Number(position.timestamp || 0),
      activationId: Number(position.activationId || 0),
      isMirror: Boolean(position.isMirrorActivation),
      source,
      unresolvedReason,
    });
  }
}

function compareOccurrence(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.activationId !== b.activationId) return a.activationId - b.activationId;
  if (a.cycleNumber !== b.cycleNumber) return a.cycleNumber - b.cycleNumber;
  if (a.position !== b.position) return a.position - b.position;
  return a.orbitOwner.localeCompare(b.orbitOwner);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const [liveSnapshots, cycleSnapshots] = await Promise.all([
    OrbitLevelSnapshot.find({ orbitType: { $in: ['P12', 'P39'] } }).lean(),
    OrbitCycleSnapshot.find({ orbitType: { $in: ['P12', 'P39'] } }).lean(),
  ]);

  const occurrences = [];
  for (const snapshot of cycleSnapshots) {
    addCycleOccurrences(occurrences, snapshot, snapshot.cycleNumber, 'historical');
  }
  for (const snapshot of liveSnapshots) {
    const currentCycle = Number(snapshot.orbitSummary?.totalCycles || 0) + 1;
    addCycleOccurrences(occurrences, snapshot, currentCycle, 'current');
  }

  // The same completed cycle can exist in both collections. Keep one structural row.
  const deduped = new Map();
  for (const occurrence of occurrences) {
    const identity = [
      occurrence.orbitType,
      occurrence.level,
      occurrence.orbitOwner,
      occurrence.cycleNumber,
      occurrence.position,
      occurrence.occupant,
    ].join(':');
    const previous = deduped.get(identity);
    if (!previous || occurrence.source === 'historical') deduped.set(identity, occurrence);
  }

  const grouped = new Map();
  for (const occurrence of deduped.values()) {
    const rows = grouped.get(occurrence.key) || [];
    rows.push(occurrence);
    grouped.set(occurrence.key, rows);
  }

  const seeds = [];
  const unresolved = [];
  const repeated = [];
  const conflictingParents = [];

  for (const rows of grouped.values()) {
    rows.sort(compareOccurrence);
    const latest = rows.at(-1);
    const knownParents = [...new Set(rows.map((row) => row.parent).filter(Boolean))];
    const row = {
      orbitType: latest.orbitType,
      level: latest.level,
      occupant: latest.occupant,
      parent: latest.parent,
      occurrenceCount: rows.length,
      knownParents,
      latestOccurrence: {
        orbitOwner: latest.orbitOwner,
        cycleNumber: latest.cycleNumber,
        position: latest.position,
        parentPosition: latest.parentPosition,
        timestamp: latest.timestamp,
        activationId: latest.activationId,
        isMirror: latest.isMirror,
        source: latest.source,
      },
    };

    if (!latest.parent) unresolved.push({ ...row, reason: latest.unresolvedReason });
    else seeds.push(row);
    if (rows.length > 1) repeated.push(row);
    if (knownParents.length > 1) conflictingParents.push(row);
  }

  const summary = {
    chainId: Number(process.env.CHAIN_ID || 137),
    liveSnapshotCount: liveSnapshots.length,
    historicalCycleSnapshotCount: cycleSnapshots.length,
    rawOccurrenceCount: occurrences.length,
    dedupedOccurrenceCount: deduped.size,
    seedCount: seeds.length,
    unresolvedCount: unresolved.length,
    repeatedOccupantLevelCount: repeated.length,
    conflictingParentCount: conflictingParents.length,
    byOrbit: {
      P12: seeds.filter((row) => row.orbitType === 'P12').length,
      P39: seeds.filter((row) => row.orbitType === 'P39').length,
    },
  };

  if (process.env.MATRIX_PARENT_LEDGER_OUT) {
    await writeFile(
      process.env.MATRIX_PARENT_LEDGER_OUT,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, seeds }, null, 2)}\n`,
      'utf8'
    );
  }

  console.log(JSON.stringify({ summary, unresolved, conflictingParents, repeated }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
