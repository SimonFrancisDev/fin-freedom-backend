import assert from 'node:assert/strict';
import test from 'node:test';
import { dueRewardPeriods, assertRewardSnapshot } from '../src/services/nftRewardSchedule.js';

test('monthly payouts begin at first configured UTC cutoff, never on launch day', () => {
  assert.deepEqual(dueRewardPeriods('202611', new Date('2026-10-31T23:59:59Z')), []);
  assert.deepEqual(dueRewardPeriods('202611', new Date('2026-11-01T00:00:00Z')),
    [{ year: 2026, month: 11, periodId: 202611 }]);
});
test('missed months catch up in order across a year boundary', () => {
  assert.deepEqual(dueRewardPeriods('202611', new Date('2027-01-10T12:00:00Z')).map((p) => p.periodId),
    [202611, 202612, 202701]);
  for (const value of ['', '202600', '202613', '202611x']) assert.throws(() => dueRewardPeriods(value));
});
test('automatic distribution refuses a period with different roots, counts or cutoff', () => {
  const snapshot = { roots: ['0xaaa', '0xbbb', '0xccc'], counts: [1, 2, 3], cutoff: new Date('2026-11-01T00:00:00Z') };
  const period = { created: true, eligibleRoots: snapshot.roots, eligibleCounts: [1n, 2n, 3n],
    cutoff: BigInt(snapshot.cutoff.getTime() / 1000) };
  assert.doesNotThrow(() => assertRewardSnapshot(period, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, created: false }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, eligibleCounts: [1n, 9n, 3n] }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, cutoff: period.cutoff + 1n }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, eligibleRoots: ['0xBAD', '0xbbb', '0xccc'] }, snapshot));
});
