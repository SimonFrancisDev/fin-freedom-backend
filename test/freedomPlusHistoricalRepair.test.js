import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, id } from 'ethers';
import { historicalFreedomPlusPosition, freedomPlusHistoricalRepairAbi } from '../src/blockchain/freedomPlusHistoricalRepair.js';
import { projectFreedomPlusEvent } from '../src/services/freedomPlusProjectionService.js';
import FreedomPlusEvent from '../src/models/FreedomPlusEvent.js';
import FreedomPlusPosition from '../src/models/FreedomPlusPosition.js';
import FreedomPlusPayment from '../src/models/FreedomPlusPayment.js';
import FreedomPlusLedgerEntry from '../src/models/FreedomPlusLedgerEntry.js';
import FreedomPlusLevelState from '../src/models/FreedomPlusLevelState.js';

const owner = '0x0000000000000000000000000000000000000001';
const participant = '0x0000000000000000000000000000000000000002';
const parent = '0x0000000000000000000000000000000000000003';
const originalTime = new Date('2026-10-02T23:50:21Z');
const repairTime = new Date('2026-11-13T20:00:00Z');
const tuple = 'tuple(address,address,bytes32,bytes32,uint256,uint40,uint8,bool)';
function fixture({ genesis = false } = {}) {
  const level = genesis ? 2 : 1;
  const contractKey = genesis ? 'p14Orbit' : 'p39Orbit';
  const data = [participant, parent, id('activation'), id('placement'), genesis ? 0n : 10000000n,
    BigInt(originalTime.getTime() / 1000), genesis ? 0 : 2, !genesis];
  const event = { chainId: 137, contractKey, eventName: 'FreedomPlusHistoricalPositionRestored',
    txHash: id('repair'), blockNumber: 900, timestamp: repairTime,
    args: { account: owner, participant, level, cycle: 0, position: genesis ? 2 : 4,
      positionData: AbiCoder.defaultAbiCoder().encode([tuple], [data]), originalTransaction: id('original') } };
  const original = { chainId: 137, contractKey, eventName: 'PositionRecorded', txHash: id('original'),
    blockNumber: 100, timestamp: originalTime,
    args: { participant, activationId: id('activation'), kind: genesis ? 0 : 1, financial: !genesis } };
  return { event, original };
}

test('restored appearance retains original payment provenance and separate repair provenance', () => {
  const { event, original } = fixture();
  const result = historicalFreedomPlusPosition(event, original);
  assert.equal(result.ring, 2);
  assert.equal(result.txHash, original.txHash);
  assert.equal(result.blockNumber, 100);
  assert.equal(result.timestamp.getTime(), originalTime.getTime());
  assert.equal(result.repairTxHash, event.txHash);
  assert.equal(result.repairBlockNumber, 900);
  assert.equal(result.repairedAt, repairTime);
  assert.equal(result.historicalRepair, true);
  assert.equal(result.amount, '10000000');
});

test('genesis restoration remains explicitly non-financial', () => {
  const { event, original } = fixture({ genesis: true });
  const result = historicalFreedomPlusPosition(event, original);
  assert.equal(result.kind, 0);
  assert.equal(result.financial, false);
  assert.equal(result.amount, '0');
});

for (const [label, mutate] of [
  ['missing indexed original', f => { f.original = null; }],
  ['different network', f => { f.original.chainId = 80002; }],
  ['different engine', f => { f.original.contractKey = 'p12Orbit'; }],
  ['different participant', f => { f.original.args.participant = parent; }],
  ['different activation', f => { f.original.args.activationId = id('another'); }],
  ['different original transaction', f => { f.original.txHash = id('another'); }],
  ['invented earlier timestamp', f => { f.original.timestamp = new Date(0); }],
  ['out-of-range destination', f => { f.event.args.position = 40; }],
  ['malformed payload', f => { f.event.args.positionData = '0x'; }],
]) test(`repair decoder rejects ${label}`, () => {
  const value = fixture(); mutate(value);
  assert.throws(() => historicalFreedomPlusPosition(value.event, value.original));
});

test('repair ABI decodes the dedicated event and preserves the original transaction', () => {
  const { event } = fixture();
  const a = event.args;
  const iface = new Interface(freedomPlusHistoricalRepairAbi);
  const parsed = iface.parseLog(iface.encodeEventLog(event.eventName,
    [a.account, a.participant, a.level, a.cycle, a.position, a.positionData, a.originalTransaction]));
  assert.equal(parsed.args.originalTransaction, a.originalTransaction);
  assert.equal(parsed.args.positionData, a.positionData);
});

test('projection is idempotent and never writes payments, earnings, or activations', async t => {
  const { event, original } = fixture();
  const writes = [];
  t.mock.method(FreedomPlusEvent, 'findOne', () => ({ sort: () => ({ lean: async () => original }) }));
  t.mock.method(FreedomPlusPosition, 'updateOne', async (filter, update) => { writes.push({ filter, update }); });
  for (const model of [FreedomPlusPayment, FreedomPlusLedgerEntry, FreedomPlusLevelState]) {
    t.mock.method(model, 'updateOne', () => { throw new Error('Unexpected financial/activation write'); });
  }
  await projectFreedomPlusEvent(event);
  await projectFreedomPlusEvent(event);
  await projectFreedomPlusEvent({ ...event, eventName: 'FreedomPlusHistoricalOrbitRestored' });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(Object.keys(writes[0].update), ['$setOnInsert']);
  assert.equal(writes[0].filter.placementId, id('placement'));
});

test('conflicting occupied slot fails closed without overwriting it', async t => {
  const { event, original } = fixture();
  t.mock.method(FreedomPlusEvent, 'findOne', () => ({ sort: () => ({ lean: async () => original }) }));
  t.mock.method(FreedomPlusPosition, 'updateOne', async () => { throw Object.assign(new Error('duplicate slot'), { code: 11000 }); });
  await assert.rejects(projectFreedomPlusEvent(event), { code: 11000 });
});
