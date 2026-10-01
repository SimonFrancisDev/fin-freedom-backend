export function dueRewardPeriods(firstPeriod, now = new Date()) {
  const value = String(firstPeriod || '');
  if (!/^\d{6}$/.test(value)) throw new Error('NFT_REWARD_FIRST_PERIOD must be YYYYMM');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4));
  if (year < 2020 || month < 1 || month > 12) throw new Error('Invalid first NFT reward period');
  const periods = [];
  const end = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const start = year * 12 + month - 1;
  if (end - start > 120) throw new Error('NFT reward catch-up exceeds ten years');
  for (let index = start; index <= end; index += 1) {
    periods.push({ year: Math.floor(index / 12), month: index % 12 + 1,
      periodId: Math.floor(index / 12) * 100 + index % 12 + 1 });
  }
  return periods;
}

export function assertRewardSnapshot(period, snapshot) {
  if (!period.created) throw new Error('Reward period was not created');
  if (Number(period.cutoff) !== new Date(snapshot.cutoff).getTime() / 1000) {
    throw new Error('Reward cutoff mismatch');
  }
  for (let i = 0; i < 3; i += 1) {
    if (String(period.eligibleRoots[i]).toLowerCase() !== snapshot.roots[i].toLowerCase()
        || BigInt(period.eligibleCounts[i]) !== BigInt(snapshot.counts[i])) {
      throw new Error('Published reward roots/counts differ from the snapshot');
    }
  }
}
