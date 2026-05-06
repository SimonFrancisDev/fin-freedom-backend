import env from './env.js';

function normalizeStartBlock(value, fallback) {
  const block = Number(value);

  if (!Number.isFinite(block) || block < 0) {
    return Number(fallback) > 0 ? Number(fallback) : 0;
  }

  return Math.floor(block);
}

function normalizePositiveNumber(value, fallback, min) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.max(min, num);
}

export function getStartBlocks() {
  const defaultStartBlock = normalizeStartBlock(env.START_BLOCK, 0);

  return {
    registration: normalizeStartBlock(
      env.START_BLOCK_REGISTRATION,
      defaultStartBlock
    ),

    levelManager: normalizeStartBlock(
      env.START_BLOCK_LEVEL_MANAGER,
      defaultStartBlock
    ),

    p4Orbit: normalizeStartBlock(
      env.START_BLOCK_P4_ORBIT,
      defaultStartBlock
    ),

    p12Orbit: normalizeStartBlock(
      env.START_BLOCK_P12_ORBIT,
      defaultStartBlock
    ),

    p39Orbit: normalizeStartBlock(
      env.START_BLOCK_P39_ORBIT,
      defaultStartBlock
    ),
    
    fgtToken: normalizeStartBlock(env.START_BLOCK_FGT_TOKEN, defaultStartBlock),
    fgtrToken: normalizeStartBlock(env.START_BLOCK_FGTR_TOKEN, defaultStartBlock),
  };
}

export function getSyncConfig() {
  return {
    confirmations: Math.max(0, Number(env.SYNC_CONFIRMATIONS) || 0),
    chunkSize: normalizePositiveNumber(env.SYNC_BLOCK_CHUNK_SIZE, 5, 1),
    pollIntervalMs: normalizePositiveNumber(env.SYNC_POLL_INTERVAL_MS, 1500, 500),
  };
}
