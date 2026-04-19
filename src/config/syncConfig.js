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
  };
}

export function getSyncConfig() {
  return {
    confirmations: Math.max(0, Number(env.SYNC_CONFIRMATIONS) || 0),
    chunkSize: normalizePositiveNumber(env.SYNC_BLOCK_CHUNK_SIZE, 5, 1),
    pollIntervalMs: normalizePositiveNumber(env.SYNC_POLL_INTERVAL_MS, 1500, 500),
  };
}


















//===========================
// SECOND VERSION
//===========================
// import env from './env.js';

// function normalizeStartBlock(value, fallback) {
//   const block = Number(value);
//   if (!Number.isFinite(block) || block < 0) {
//     return Number(fallback) > 0 ? Number(fallback) : 0;
//   }
//   return Math.floor(block);
// }

// export function getStartBlocks() {
//   const defaultStartBlock = normalizeStartBlock(env.START_BLOCK, 0);

//   return {
//     registration: normalizeStartBlock(
//       env.START_BLOCK_REGISTRATION,
//       defaultStartBlock
//     ),

//     levelManager: normalizeStartBlock(
//       env.START_BLOCK_LEVEL_MANAGER,
//       defaultStartBlock
//     ),

//     p4Orbit: normalizeStartBlock(
//       env.START_BLOCK_P4_ORBIT,
//       defaultStartBlock
//     ),

//     p12Orbit: normalizeStartBlock(
//       env.START_BLOCK_P12_ORBIT,
//       defaultStartBlock
//     ),

//     p39Orbit: normalizeStartBlock(
//       env.START_BLOCK_P39_ORBIT,
//       defaultStartBlock
//     ),
//   };
// }

// export function getSyncConfig() {
//   return {
//     confirmations: Math.max(0, Number(env.SYNC_CONFIRMATIONS) || 0),
//     chunkSize: Math.max(1, Number(env.SYNC_BLOCK_CHUNK_SIZE) || 1),
//     pollIntervalMs: Math.max(500, Number(env.SYNC_POLL_INTERVAL_MS) || 1000),
//   };
// }












//===========================
// FIRST VERSION
//===========================
// import env from './env.js';

// export function getStartBlocks() {
//   return {
//     registration:
//       env.START_BLOCK_REGISTRATION > 0
//         ? env.START_BLOCK_REGISTRATION
//         : env.START_BLOCK,

//     levelManager:
//       env.START_BLOCK_LEVEL_MANAGER > 0
//         ? env.START_BLOCK_LEVEL_MANAGER
//         : env.START_BLOCK,

//     p4Orbit:
//       env.START_BLOCK_P4_ORBIT > 0
//         ? env.START_BLOCK_P4_ORBIT
//         : env.START_BLOCK,

//     p12Orbit:
//       env.START_BLOCK_P12_ORBIT > 0
//         ? env.START_BLOCK_P12_ORBIT
//         : env.START_BLOCK,

//     p39Orbit:
//       env.START_BLOCK_P39_ORBIT > 0
//         ? env.START_BLOCK_P39_ORBIT
//         : env.START_BLOCK,
//   };
// }

// export function getSyncConfig() {
//   return {
//     confirmations: Math.max(0, env.SYNC_CONFIRMATIONS),
//     chunkSize: Math.max(1, env.SYNC_BLOCK_CHUNK_SIZE),
//     pollIntervalMs: Math.max(500, env.SYNC_POLL_INTERVAL_MS),
//   };
// }
