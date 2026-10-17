import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dueRewardCycles, rewardCyclesReadyForSnapshot, nextRewardCycle,
  parseFirstDistributionAt, assertRewardSnapshot,
} from '../src/services/nftRewardSchedule.js';

const FIRST = '2026-11-02T00:00:00.000Z';

test('fixed payouts begin at the configured UTC instant with a 24-hour cutoff', () => {
  assert.deepEqual(dueRewardCycles(FIRST, new Date('2026-11-01T23:59:59Z')), []);
  const [cycle] = dueRewardCycles(FIRST, new Date('2026-11-02T00:00:00Z'));
  assert.equal(cycle.cycleId, 1);
  assert.equal(cycle.periodId, 1);
  assert.equal(cycle.distributionAt.toISOString(), FIRST);
  assert.equal(cycle.cutoffAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('missed cycles catch up in exact 30-day increments rather than calendar months', () => {
  const cycles = dueRewardCycles(FIRST, new Date('2027-01-01T00:00:00Z'));
  assert.deepEqual(cycles.map((cycle) => cycle.cycleId), [1, 2, 3]);
  assert.deepEqual(cycles.map((cycle) => cycle.distributionAt.toISOString()), [
    '2026-11-02T00:00:00.000Z',
    '2026-12-02T00:00:00.000Z',
    '2027-01-01T00:00:00.000Z',
  ]);
});

test('the final 24 hours freeze only upcoming eligibility', () => {
  const before = nextRewardCycle(FIRST, new Date('2026-10-31T23:59:59Z'));
  const frozen = nextRewardCycle(FIRST, new Date('2026-11-01T00:00:00Z'));
  assert.equal(before.cycleId, 1);
  assert.equal(before.eligibilityFrozen, false);
  assert.equal(frozen.cycleId, 1);
  assert.equal(frozen.eligibilityFrozen, true);
  assert.deepEqual(rewardCyclesReadyForSnapshot(FIRST, new Date('2026-10-31T23:59:59Z')), []);
  assert.equal(
    rewardCyclesReadyForSnapshot(FIRST, new Date('2026-11-01T00:00:00Z'))[0].cycleId,
    1
  );
});

test('schedule parsing rejects non-midnight and malformed values', () => {
  assert.equal(parseFirstDistributionAt('1793577600').toISOString(), FIRST);
  for (const value of ['', 'invalid', '2026-11-02T00:00:01Z']) {
    assert.throws(() => parseFirstDistributionAt(value));
  }
});

test('automatic distribution refuses a cycle with different roots, counts or times', () => {
  const snapshot = {
    roots: ['0xaaa', '0xbbb', '0xccc'],
    counts: [1, 2, 3],
    cutoff: new Date('2026-11-01T00:00:00Z'),
    distributionAt: new Date(FIRST),
  };
  const period = {
    created: true,
    eligibleRoots: snapshot.roots,
    eligibleCounts: [1n, 2n, 3n],
    cutoff: BigInt(snapshot.cutoff.getTime() / 1000),
    distributionAt: BigInt(snapshot.distributionAt.getTime() / 1000),
  };
  assert.doesNotThrow(() => assertRewardSnapshot(period, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, created: false }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, eligibleCounts: [1n, 9n, 3n] }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, cutoff: period.cutoff + 1n }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, distributionAt: period.distributionAt + 1n }, snapshot));
  assert.throws(() => assertRewardSnapshot({ ...period, eligibleRoots: ['0xBAD', '0xbbb', '0xccc'] }, snapshot));
});
