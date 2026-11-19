import './setupEnv.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AbiCoder, ZeroAddress } from 'ethers';
import { orbitReceiptQuery, selectOrbitReceipts, orbitReceiptMetadata,
  ORBIT_RECEIPT_SNAPSHOT_VERSIONS } from '../src/services/snapshots/orbitReceiptProjection.js';
import { buildOrbitLevelSnapshot } from '../src/services/snapshots/orbitLevelSnapshotBuilder.js';
import { buildOrbitPositionSnapshot } from '../src/services/snapshots/orbitPositionSnapshotBuilder.js';
import { buildOrbitCycleSnapshot } from '../src/services/snapshots/orbitCycleSnapshotBuilder.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import OrbitPositionSnapshot from '../src/models/OrbitPositionSnapshot.js';
import OrbitCycleSnapshot from '../src/models/OrbitCycleSnapshot.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mainnet-orbit-receipts-2026-11-19.json', import.meta.url)));
const A = '0x000000000000000000000000000000000000000a';
const B = '0x000000000000000000000000000000000000000b';
const C = '0x000000000000000000000000000000000000000c';
const receipt = (overrides = {}) => ({
  chainId: 137, txHash: '0xabc', logIndex: 9, blockNumber: 100,
  activationId: '17', orbitOwner: A, receiver: B, fromUser: C, level: 4,
  sourcePosition: 4, sourceCycle: 1, mirroredPosition: 3, mirroredCycle: 4,
  receiptType: 4, grossAmount: '72000000', liquidPaid: '72000000', escrowLocked: '0',
  ...overrides,
});
const destination = { address: B, level: 4, position: 3, cycleNumber: 4 };

test('source and mirrored receipt coordinates use independent owners, positions and cycles', () => {
  const row = receipt();
  assert.deepEqual(selectOrbitReceipts([row], destination), [row]);
  assert.deepEqual(selectOrbitReceipts([row], { address: A, level: 4, position: 4, cycleNumber: 1 }), [row]);
  for (const override of [{ address: C }, { level: 3 }, { position: 4 }, { cycleNumber: 1 }]) {
    assert.deepEqual(selectOrbitReceipts([row], { ...destination, ...override }), []);
  }
  assert.deepEqual(orbitReceiptMetadata([row], destination), { activationId: 17, isMirrorActivation: true });
  assert.deepEqual(orbitReceiptMetadata([row], { address: A, level: 4, position: 4, cycleNumber: 1 }),
    { activationId: 17, isMirrorActivation: false });
});

test('fallback payments with no mirrored slot cannot invent a recipient placement', () => {
  assert.deepEqual(selectOrbitReceipts([receipt({ mirroredPosition: 0 })], destination), []);
  assert.deepEqual(orbitReceiptMetadata([], destination), { activationId: 0, isMirrorActivation: false });
});

test('a tagged closing receipt remains in the old source cycle even after the reset log', () => {
  const reset = { blockNumber: 100, logIndex: 8 };
  const row = receipt();
  assert.equal(selectOrbitReceipts([row], { address: A, level: 4, cycleNumber: 1, beforeReset: reset }).length, 1);
  assert.equal(selectOrbitReceipts([row], { address: A, level: 4, cycleNumber: 2, afterReset: reset }).length, 0);
  assert.equal(selectOrbitReceipts([row], { ...destination, afterReset: { blockNumber: 50, logIndex: 0 } }).length, 1);
});

test('legacy untagged receipts obey reset boundaries without admitting an explicitly different cycle', () => {
  const afterReset = { blockNumber: 100, logIndex: 8 };
  const rows = [receipt({ sourceCycle: 0 }), receipt({ sourceCycle: 0, logIndex: 7 }), receipt({ logIndex: 10 })];
  assert.deepEqual(selectOrbitReceipts(rows, { address: A, level: 4, cycleNumber: 2, afterReset }), [rows[0]]);
  assert.deepEqual(selectOrbitReceipts(rows, { address: A, level: 4, cycleNumber: 2 }), []);
});

test('duplicate delivery and overlapping source/receiver matches do not double count or mutate receipts', () => {
  const row = receipt({ receiver: A, mirroredPosition: 4, mirroredCycle: 1 });
  const original = structuredClone(row);
  const rows = selectOrbitReceipts([row, structuredClone(row)], { address: A, level: 4, position: 4, cycleNumber: 1 });
  assert.equal(rows.length, 1);
  assert.deepEqual(row, original);
  assert.equal(rows[0].grossAmount, '72000000');
});

test('a wallet present on both sides still keeps source and destination cycles separate', () => {
  const row = receipt({ receiver: A });
  assert.equal(selectOrbitReceipts([row], { ...destination, address: A }).length, 1);
  assert.equal(selectOrbitReceipts([row], { ...destination, address: A, cycleNumber: 1 }).length, 0);
  assert.equal(selectOrbitReceipts([row], { ...destination, address: A, position: 4, cycleNumber: 4 }).length, 0);
});

test('receipt queries correlate each coordinate with its owning wallet', () => {
  assert.deepEqual(orbitReceiptQuery(B, 4, { position: 3, cycleNumber: 4 }), {
    level: 4, $or: [
      { orbitOwner: B, sourcePosition: 3, sourceCycle: 4 },
      { receiver: B, mirroredPosition: 3, mirroredCycle: 4 },
    ],
  });
  assert.deepEqual(orbitReceiptQuery(B, 4).$or[1].mirroredPosition, { $gt: 0 });
});

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(row, branch));
    if (value && typeof value === 'object' && '$gt' in value) return Number(row[key]) > value.$gt;
    return String(row[key]).toLowerCase() === String(value).toLowerCase();
  });
}

function queryResult(rows) {
  return { sort() { return this; }, lean: async () => structuredClone(rows) };
}

function isolateModels(t, example) {
  const events = structuredClone(example.events);
  if (example.preCompletedCycles) {
    // Seed only the already-verified previous cycle count; this is not a new
    // chain event or payment. No live RPC or database is used by these tests.
    events.unshift({ eventName: 'OrbitReset', orbitOwner: example.orbitOwner.toLowerCase(),
      orbitType: example.events[0].orbitType, level: Number(example.level), position: 0,
      blockNumber: example.receipts[0].blockNumber - 1, logIndex: 0,
      cycleNumber: example.preCompletedCycles });
  }
  t.mock.method(IndexedReceipt, 'find', (query) => queryResult(example.receipts.filter((row) => matches(row, query))));
  t.mock.method(IndexedOrbitEvent, 'find', (query) => queryResult(events.filter((row) => matches(row, query))));
  const snapshots = new Map();
  for (const model of [OrbitLevelSnapshot, OrbitPositionSnapshot, OrbitCycleSnapshot]) {
    t.mock.method(model, 'findOne', () => ({
      lean: async () => structuredClone(snapshots.get(model) || null),
      // The unrelated chain-summary enricher sees no document to enrich.
      then: (resolve) => Promise.resolve(null).then(resolve),
    }));
    t.mock.method(model, 'findOneAndUpdate', (_query, update) => {
      snapshots.set(model, structuredClone(update.$set));
      return queryResult(update.$set);
    });
  }
  return snapshots;
}

for (const example of fixture.cases) {
  test(`mainnet activation ${example.activationId}, L${example.level} slot ${example.position}: all three views link the paid receipt`, async (t) => {
    const original = structuredClone(example);
    const snapshots = isolateModels(t, example);
    const level = Number(example.level), position = Number(example.position), cycle = Number(example.cycle);
    await buildOrbitLevelSnapshot(example.orbitOwner, level);
    await buildOrbitPositionSnapshot(example.orbitOwner, level, position);
    await buildOrbitCycleSnapshot(example.orbitOwner, level, cycle);
    const levelRow = snapshots.get(OrbitLevelSnapshot).positions.find((row) => row.number === position);
    const detail = snapshots.get(OrbitPositionSnapshot);
    const history = snapshots.get(OrbitCycleSnapshot).positions.find((row) => row.number === position);
    for (const row of [levelRow, detail, history]) {
      assert.equal(row.occupant.toLowerCase(), example.participant.toLowerCase());
      assert.equal(row.activationId, Number(example.activationId));
      assert.equal(row.activationCycleNumber, cycle);
      assert.equal(row.isMirrorActivation, true);
      assert.equal(row.indexedReceiptCount, 1);
      assert.notEqual(row.truthLabel, 'NO_RECEIPT');
      assert.equal(Number(row.viewerReceiptBreakdown.totalLiquid), Number(example.correctLiquidUsdt));
      assert.equal(Number(row.viewerReceiptBreakdown.totalEscrow), Number(example.correctEscrowUsdt));
      assert.equal(Number(row.viewerReceiptBreakdown.totalGross),
        Number(example.correctLiquidUsdt) + Number(example.correctEscrowUsdt));
    }
    assert.equal(snapshots.get(OrbitLevelSnapshot).metadata.snapshotVersion, ORBIT_RECEIPT_SNAPSHOT_VERSIONS.level);
    assert.equal(detail.metadata.snapshotVersion, ORBIT_RECEIPT_SNAPSHOT_VERSIONS.position);
    assert.equal(snapshots.get(OrbitCycleSnapshot).metadata.snapshotVersion, ORBIT_RECEIPT_SNAPSHOT_VERSIONS.cycle);
    assert.deepEqual(example, original);
  });
}

test('direct placement retains all disbursements but credits only the viewed owner', async (t) => {
  const example = structuredClone(fixture.cases[0]);
  const source = example.receipts[0];
  example.orbitOwner = source.orbitOwner;
  const snapshots = isolateModels(t, example);
  await buildOrbitLevelSnapshot(example.orbitOwner, source.level);
  await buildOrbitPositionSnapshot(example.orbitOwner, source.level, source.sourcePosition);
  await buildOrbitCycleSnapshot(example.orbitOwner, source.level, source.sourceCycle);
  const rows = [snapshots.get(OrbitPositionSnapshot),
    ...[OrbitLevelSnapshot, OrbitCycleSnapshot].map((model) =>
      snapshots.get(model).positions.find((row) => row.number === source.sourcePosition))];
  for (const row of rows) {
    assert.equal(row.occupant.toLowerCase(), source.fromUser.toLowerCase());
    assert.equal(row.activationId, Number(source.activationId));
    assert.equal(row.isMirrorActivation, false);
    assert.equal(row.indexedReceiptCount, 2);
    assert.equal(Number(row.viewerReceiptBreakdown.totalGross), 8);
    assert.equal(Number(row.viewerReceiptBreakdown.totalLiquid), 8);
  }
});

test('recycled source stays empty in its new cycle while its old cycle retains the outgoing payment', async (t) => {
  const example = structuredClone(fixture.cases.find((row) => row.activationId === '1192'));
  const source = example.receipts[0];
  example.orbitOwner = source.orbitOwner;
  example.preCompletedCycles = 0;
  const snapshots = isolateModels(t, example);
  await buildOrbitLevelSnapshot(source.orbitOwner, source.level);
  await buildOrbitPositionSnapshot(source.orbitOwner, source.level, source.sourcePosition);
  await buildOrbitCycleSnapshot(source.orbitOwner, source.level, source.sourceCycle);
  for (const row of [snapshots.get(OrbitPositionSnapshot),
    snapshots.get(OrbitLevelSnapshot).positions.find((row) => row.number === source.sourcePosition)]) {
    assert.equal(row.occupant, null);
    assert.equal(row.activationCycleNumber, 2);
    assert.equal(row.indexedReceiptCount, 0);
    assert.equal(Number(row.viewerReceiptBreakdown.totalGross), 0);
  }
  const history = snapshots.get(OrbitCycleSnapshot).positions.find((row) => row.number === source.sourcePosition);
  assert.equal(history.occupant.toLowerCase(), source.fromUser.toLowerCase());
  assert.equal(history.indexedReceiptCount, 1);
  assert.equal(Number(history.viewerReceiptBreakdown.totalGross), 0);
  assert.equal(history.indexedReceipts[0].receiver.toLowerCase(), source.receiver.toLowerCase());
});

test('a later non-placement event cannot replace the occupied wallet', async (t) => {
  const example = structuredClone(fixture.cases[0]);
  const fill = example.events.find((row) => row.orbitOwner === example.orbitOwner.toLowerCase());
  example.events.push({ ...fill, eventName: 'LinePaymentTracked', logIndex: fill.logIndex + 1, user: C });
  const snapshots = isolateModels(t, example);
  await buildOrbitPositionSnapshot(example.orbitOwner, Number(example.level), Number(example.position));
  assert.equal(snapshots.get(OrbitPositionSnapshot).occupant.toLowerCase(), example.participant.toLowerCase());
});

test('payment evidence alone does not manufacture an occupied position', async (t) => {
  const example = structuredClone(fixture.cases[0]);
  example.events = [];
  const snapshots = isolateModels(t, example);
  await buildOrbitLevelSnapshot(example.orbitOwner, Number(example.level));
  await buildOrbitPositionSnapshot(example.orbitOwner, Number(example.level), Number(example.position));
  await buildOrbitCycleSnapshot(example.orbitOwner, Number(example.level), Number(example.cycle));
  assert.equal(snapshots.get(OrbitPositionSnapshot).occupant, null);
  for (const model of [OrbitLevelSnapshot, OrbitCycleSnapshot]) {
    assert.equal(snapshots.get(model).positions.some((row) => row.occupant), false);
  }
});

test('ancestry-only historical repair stays non-paying in all three builders', async (t) => {
  const example = structuredClone(fixture.cases[0]);
  const fill = example.events.find((row) => row.orbitOwner === example.orbitOwner.toLowerCase());
  const slotType = '((address,uint256,uint256,address,bool),address,uint8,uint256,bool,(bool,uint8,uint8,bool,bool,uint256,uint256,uint256,uint256,uint256,address,address))';
  const slot = AbiCoder.defaultAbiCoder().encode([slotType], [
    [[example.participant, 0, 1794819130, example.orbitOwner, true], ZeroAddress, 1,
      BigInt(example.activationId), true, [true, 1, 0, false, false, 0, 0, 0, 0, 0, ZeroAddress, ZeroAddress]],
  ]);
  example.events.push({ ...fill, eventName: 'HistoricalOrbitSlotRepaired', blockNumber: fill.blockNumber + 1,
    logIndex: 1, amount: '0', raw: { '5': slot } });
  const snapshots = isolateModels(t, example);
  await buildOrbitLevelSnapshot(example.orbitOwner, Number(example.level));
  await buildOrbitPositionSnapshot(example.orbitOwner, Number(example.level), Number(example.position));
  await buildOrbitCycleSnapshot(example.orbitOwner, Number(example.level), Number(example.cycle));
  for (const row of [snapshots.get(OrbitPositionSnapshot),
    ...[OrbitLevelSnapshot, OrbitCycleSnapshot].map((model) =>
      snapshots.get(model).positions.find((row) => row.number === Number(example.position)))]) {
    assert.equal(row.occupant.toLowerCase(), example.participant.toLowerCase());
    assert.equal(row.truthLabel, 'STRUCTURAL_REPAIR');
    assert.equal(row.indexedReceiptCount, 0);
    assert.equal(Number(row.viewerReceiptBreakdown.totalGross), 0);
  }
});

test('old snapshots rebuild on access and receipt arrivals refresh both orbits without polling', () => {
  const query = readFileSync(new URL('../src/services/read/orbitQueryService.js', import.meta.url), 'utf8');
  for (const kind of ['level', 'position', 'cycle']) assert.match(query, new RegExp('< ORBIT_RECEIPT_SNAPSHOT_VERSIONS\\.' + kind));
  const indexer = readFileSync(new URL('../src/services/indexerService.js', import.meta.url), 'utf8');
  assert.match(indexer, /for \(const address of receiptOrbitOwners\)/);
  assert.match(indexer, /args\.mirroredPosition/);
  assert.doesNotMatch(indexer, /setInterval\([^)]*OrbitSnapshot/);
});
