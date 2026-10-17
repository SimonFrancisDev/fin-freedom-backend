const DAY_MS = 24 * 60 * 60 * 1000;
export const NFT_REWARD_CYCLE_MS = 30 * DAY_MS;
export const NFT_REWARD_FREEZE_MS = DAY_MS;

export function parseFirstDistributionAt(value) {
  const raw = String(value || '').trim();
  const milliseconds = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error('NFT_REWARD_FIRST_DISTRIBUTION_AT must be an ISO UTC timestamp or Unix seconds');
  }
  const date = new Date(milliseconds);
  if (
    date.getUTCHours() !== 0
    || date.getUTCMinutes() !== 0
    || date.getUTCSeconds() !== 0
    || date.getUTCMilliseconds() !== 0
  ) {
    throw new Error('NFT_REWARD_FIRST_DISTRIBUTION_AT must be exactly 00:00 UTC');
  }
  return date;
}

export function dueRewardCycles(firstDistributionAt, now = new Date()) {
  const first = parseFirstDistributionAt(firstDistributionAt);
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('Invalid current NFT reward time');
  if (current.getTime() < first.getTime()) return [];

  const completedCycles = Math.floor((current.getTime() - first.getTime()) / NFT_REWARD_CYCLE_MS) + 1;
  if (completedCycles > 120) throw new Error('NFT reward catch-up exceeds 120 cycles');
  return Array.from({ length: completedCycles }, (_, index) => {
    const distributionAt = new Date(first.getTime() + index * NFT_REWARD_CYCLE_MS);
    return {
      cycleId: index + 1,
      periodId: index + 1,
      distributionAt,
      cutoffAt: new Date(distributionAt.getTime() - NFT_REWARD_FREEZE_MS),
    };
  });
}

export function rewardCyclesReadyForSnapshot(firstDistributionAt, now = new Date()) {
  const first = parseFirstDistributionAt(firstDistributionAt);
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('Invalid current NFT reward time');
  const firstCutoff = first.getTime() - NFT_REWARD_FREEZE_MS;
  if (current.getTime() < firstCutoff) return [];

  const reachedCutoffs = Math.floor((current.getTime() - firstCutoff) / NFT_REWARD_CYCLE_MS) + 1;
  if (reachedCutoffs > 120) throw new Error('NFT reward catch-up exceeds 120 cycles');
  return Array.from({ length: reachedCutoffs }, (_, index) => {
    const distributionAt = new Date(first.getTime() + index * NFT_REWARD_CYCLE_MS);
    return {
      cycleId: index + 1,
      periodId: index + 1,
      distributionAt,
      cutoffAt: new Date(distributionAt.getTime() - NFT_REWARD_FREEZE_MS),
    };
  });
}

export function nextRewardCycle(firstDistributionAt, now = new Date()) {
  const first = parseFirstDistributionAt(firstDistributionAt);
  const current = now instanceof Date ? now : new Date(now);
  const elapsed = current.getTime() - first.getTime();
  const index = elapsed < 0 ? 0 : Math.floor(elapsed / NFT_REWARD_CYCLE_MS) + 1;
  const distributionAt = new Date(first.getTime() + index * NFT_REWARD_CYCLE_MS);
  return {
    cycleId: index + 1,
    periodId: index + 1,
    distributionAt,
    cutoffAt: new Date(distributionAt.getTime() - NFT_REWARD_FREEZE_MS),
    eligibilityFrozen: current.getTime() >= distributionAt.getTime() - NFT_REWARD_FREEZE_MS,
  };
}

export function assertRewardSnapshot(period, snapshot) {
  if (!period.created) throw new Error('Reward cycle was not created');
  if (Number(period.cutoff) !== new Date(snapshot.cutoff).getTime() / 1000) {
    throw new Error('Reward cutoff mismatch');
  }
  if (Number(period.distributionAt) !== new Date(snapshot.distributionAt).getTime() / 1000) {
    throw new Error('Reward distribution time mismatch');
  }
  for (let i = 0; i < 3; i += 1) {
    if (
      String(period.eligibleRoots[i]).toLowerCase() !== snapshot.roots[i].toLowerCase()
      || BigInt(period.eligibleCounts[i]) !== BigInt(snapshot.counts[i])
    ) {
      throw new Error('Published reward roots/counts differ from the snapshot');
    }
  }
}
