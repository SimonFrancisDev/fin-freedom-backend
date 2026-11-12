// Offline: compare real fork-emitted repair logs with the recorded expected slots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Interface, ZeroAddress, formatUnits } from 'ethers';
import { historicalOrbitRepairAbi, historicalOrbitEventFields, applyHistoricalOrbitRepair } from '../src/blockchain/historicalOrbitRepair.js';

const [input, output] = process.argv.slice(2);
assert(input, 'Pass the completed structural-only fork evidence JSON');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
assert.equal(evidence.status, 'passed');
assert.equal(evidence.sourceChainId, 137);
assert.equal(evidence.executionChainId, 31337);
assert.equal(evidence.manifest.repairTransferRaw, '0');
assert.deepEqual(evidence.before, evidence.after);
const iface = new Interface(historicalOrbitRepairAbi);
const events = evidence.repairTransaction.logs.flatMap((log, index) => {
  let parsed;
  try { parsed = iface.parseLog(log); } catch { return []; }
  if (!parsed) return [];
  const fields = historicalOrbitEventFields(parsed);
  assert.equal(fields.amount, '0');
  return [{ ...fields, eventName: parsed.name, contractAddress: log.address.toLowerCase(),
    blockNumber: evidence.forkBlock + 1, logIndex: index,
    raw: Object.fromEntries(Array.from(parsed.args, (value, key) => [String(key),
      typeof value === 'bigint' ? value.toString() : value])) }];
});
assert(events.length > 0);
const summary = () => ({ truthLabel: 'NO_RECEIPT', totals: { count: 0, gross: '0' }, viewerBreakdown: { count: 0 } });
let checkedSlots = 0;
let correctedSlots = 0;
for (const group of evidence.manifest.edits) {
  for (const [address, level, , expectedSlots] of group.edits) {
    const old = group.before.find(row => row.wallet.toLowerCase() === address.toLowerCase() && row.level === level);
    const orbitEvents = events.filter(event => event.orbitOwner === address.toLowerCase() && event.level === level);
    const cycleNumber = orbitEvents.find(event => event.cycleNumber > 0)?.cycleNumber;
    assert(cycleNumber > 0, 'Every reviewed orbit must have a slot journal');
    for (let index = 0; index < expectedSlots.length; index++) {
      const slot = old.slots[index];
      const original = { occupant: slot[0][0] === ZeroAddress ? null : slot[0][0].toLowerCase(),
        amount: formatUnits(slot[0][1], 6), timestamp: Number(slot[0][2]),
        activationId: Number(slot[3]), activationCycleNumber: cycleNumber, isMirrorActivation: slot[4] };
      const result = applyHistoricalOrbitRepair({ snapshot: original, position: index + 1, cycleNumber,
        events: orbitEvents, receipts: [], viewedAddress: address, summarizeReceipts: summary });
      const expected = expectedSlots[index];
      assert.equal(result.occupant, expected[0][0] === ZeroAddress ? null : expected[0][0].toLowerCase());
      assert.equal(result.amount, formatUnits(expected[0][1], 6));
      assert.equal(result.timestamp, Number(expected[0][2]));
      assert.equal(result.activationId, Number(expected[3]));
      assert.equal(result.isMirrorActivation, expected[4]);
      if (result !== original) {
        correctedSlots++;
        assert.equal(result.receiptTotals.gross, '0');
        assert.equal(result.indexedReceiptCount, 0);
      }
      checkedSlots++;
    }
  }
}
const result = { status: 'passed', sourceChainId: 137, executionChainId: 31337,
  forkBlock: evidence.forkBlock, checkedSlots, correctedSlots, indexedRepairEvents: events.length,
  repairTransferRaw: '0', databaseWrites: 0,
  scope: 'Offline projection of fork-emitted logs; not a hosted API or browser certification' };
if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
