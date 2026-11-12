import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, ZeroAddress, ZeroHash } from 'ethers';
import { readFileSync } from 'node:fs';
import { applyHistoricalOrbitRepair, decodeHistoricalOrbitSlot, historicalOrbitEventFields,
  historicalOrbitRepairAbi, historicalOrbitRepairEventNames } from '../src/blockchain/historicalOrbitRepair.js';

const owner = '0x0000000000000000000000000000000000000001';
const sofia = '0x0000000000000000000000000000000000000002';
const sabina = '0x0000000000000000000000000000000000000003';
const iface = new Interface(historicalOrbitRepairAbi);
const slotType = '((address,uint256,uint256,address,bool),address,uint8,uint256,bool,(bool,uint8,uint8,bool,bool,uint256,uint256,uint256,uint256,uint256,address,address))';
function encodedSlot(user = sofia, amount = 1280000000n, id = 1126n, mirror = false) {
  return AbiCoder.defaultAbiCoder().encode([slotType], [
    [[user, amount, 1793510253n, owner, true], ZeroAddress, 3, id, mirror,
      [true, 1, 0, false, false, amount * 9n / 10n, 0, 0, 0, 0, ZeroAddress, ZeroAddress]],
  ]);
}
function repair(bytes = encodedSlot(), position = 3, cycle = 1) {
  const log = iface.encodeEventLog(iface.getEvent('HistoricalOrbitSlotRepaired'),
    [owner, 8, cycle, position, bytes, bytes, bytes]);
  const parsed = iface.parseLog(log);
  return { eventName: parsed.name, ...historicalOrbitEventFields(parsed), blockNumber: 100, logIndex: 2,
    raw: Object.fromEntries(Array.from(parsed.args, (value, index) => [String(index), typeof value === 'bigint' ? String(value) : value])) };
}
const summarizeReceipts = (rows) => ({ truthLabel: rows.length ? 'FOUNDER_PATH' : 'NO_RECEIPT',
  totals: { count: rows.length, gross: rows.reduce((n, r) => n + BigInt(r.grossAmount || 0), 0n).toString() },
  viewerBreakdown: { count: rows.length } });
const base = { occupant: sabina, amount: '1280.0', activationId: 1132, number: 3, parentPosition: null };
const project = (events, receipts = [], snapshot = base, cycleNumber = 1) => applyHistoricalOrbitRepair({
  snapshot, position: 3, cycleNumber, events, receipts, viewedAddress: owner, summarizeReceipts });

test('repair events remain structural with zero newly paid amount', () => {
  const event = repair();
  assert.equal(event.amount, '0');
  assert.equal(event.user, sofia);
  assert.equal(decodeHistoricalOrbitSlot(event.raw['5']).position.amount, 1280000000n);
  for (const name of ['HistoricalOrbitRepaired', 'HistoricalAncestryRestored']) {
    const args = name === 'HistoricalOrbitRepaired' ? [owner, 8, ZeroHash, ZeroHash] : [owner, 8, sabina, 1, 1132];
    assert.equal(historicalOrbitEventFields(iface.parseLog(iface.encodeEventLog(name, args))).amount, '0');
  }
  assert.equal(historicalOrbitEventFields({ name: 'PositionFilled' }), null);
});

test('restored occupant uses its own activation receipts, not the displaced occupant receipts', () => {
  const receipts = [
    { activationId: 1132, grossAmount: '1152000000', blockNumber: 10, logIndex: 5 },
    { activationId: 1126, grossAmount: '1152000000', blockNumber: 9, logIndex: 5 },
  ];
  const original = structuredClone(receipts);
  const result = project([repair()], receipts);
  assert.equal(result.occupant, sofia);
  assert.equal(result.activationId, 1126);
  assert.equal(result.indexedReceiptCount, 1);
  assert.equal(result.indexedReceipts[0].activationId, 1126);
  assert.equal(result.ruleView.toOwner, '1152.0');
  assert.deepEqual(receipts, original);
  assert.equal(base.occupant, sabina);
});

test('ancestry-only mirror cannot invent or borrow any receipt, earnings or timestamp', () => {
  const result = project([repair(encodedSlot(sabina, 0n, 1132n, true))],
    [{ activationId: 1132, grossAmount: '512000000' }]);
  assert.equal(result.occupant, sabina);
  assert.equal(result.timestamp, 1793510253);
  assert.equal(result.amount, '0.0');
  assert.equal(result.isMirrorActivation, true);
  assert.equal(result.truthLabel, 'STRUCTURAL_REPAIR');
  assert.equal(result.receiptTotals.gross, '0');
  assert.deepEqual(result.indexedReceipts, []);
  for (const key of ['toOwner', 'toSpillover1', 'toSpillover2', 'toEscrow', 'toRecycle']) {
    assert.equal(result.ruleView[key], '0.0');
  }
});

test('cleared slot cannot be resurrected by old fills or old payout receipts', () => {
  const result = project([{ eventName: 'PositionFilled', position: 3, cycleNumber: 1, blockNumber: 99, logIndex: 1, user: sabina },
    repair(encodedSlot(ZeroAddress, 0n, 0n))], [{ activationId: 1132, grossAmount: '1152000000' }]);
  assert.equal(result.occupant, null);
  assert.equal(result.indexedReceiptCount, 0);
});

test('later fill, reset and different cycle take precedence over earlier repair', () => {
  assert.equal(project([repair()], [], base, 2), base);
  assert.equal(project([repair(), { eventName: 'OrbitReset', blockNumber: 101, logIndex: 1 }]), base);
  assert.equal(project([repair(), { eventName: 'PositionFilled', position: 3, cycleNumber: 1, blockNumber: 100, logIndex: 3 }]), base);
});

test('duplicate delivery and ordering do not double-count payment or placement', () => {
  const event = repair();
  const fill = { eventName: 'PositionFilled', position: 3, cycleNumber: 1, blockNumber: 99, logIndex: 1 };
  for (const events of [[event, fill], [fill, event], [event, event, fill]]) {
    const result = project(events);
    assert.equal(result.occupant, sofia);
    assert.equal(result.amount, '1280.0');
    assert.equal(result.receiptTotals.gross, '0');
  }
});

test('malformed repair payload fails closed instead of returning an invented occupant', () => {
  const event = repair();
  event.raw['5'] = '0x01';
  assert.throws(() => project([event]));
});

test('all orbit builders and both indexer paths are wired without polling', () => {
  for (const file of ['orbitLevelSnapshotBuilder', 'orbitCycleSnapshotBuilder', 'orbitPositionSnapshotBuilder']) {
    const source = readFileSync(new URL(`../src/services/snapshots/${file}.js`, import.meta.url), 'utf8');
    assert.match(source, /applyHistoricalOrbitRepair\(\{/);
  }
  for (const file of ['indexerService', 'realtimeEventIndexer']) {
    const source = readFileSync(new URL(`../src/services/${file}.js`, import.meta.url), 'utf8');
    assert.match(source, /\.\.\.historicalOrbitRepairEventNames/);
  }
  assert.equal(historicalOrbitRepairEventNames.length, 3);
});
