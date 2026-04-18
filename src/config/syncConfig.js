import env from './env.js';

export function getStartBlocks() {
  return {
    registration:
      env.START_BLOCK_REGISTRATION > 0
        ? env.START_BLOCK_REGISTRATION
        : env.START_BLOCK,

    levelManager:
      env.START_BLOCK_LEVEL_MANAGER > 0
        ? env.START_BLOCK_LEVEL_MANAGER
        : env.START_BLOCK,

    p4Orbit:
      env.START_BLOCK_P4_ORBIT > 0
        ? env.START_BLOCK_P4_ORBIT
        : env.START_BLOCK,

    p12Orbit:
      env.START_BLOCK_P12_ORBIT > 0
        ? env.START_BLOCK_P12_ORBIT
        : env.START_BLOCK,

    p39Orbit:
      env.START_BLOCK_P39_ORBIT > 0
        ? env.START_BLOCK_P39_ORBIT
        : env.START_BLOCK,
  };
}

export function getSyncConfig() {
  return {
    confirmations: Math.max(0, env.SYNC_CONFIRMATIONS),
    chunkSize: Math.max(1, env.SYNC_BLOCK_CHUNK_SIZE),
    pollIntervalMs: Math.max(500, env.SYNC_POLL_INTERVAL_MS),
  };
}











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
//     confirmations: env.SYNC_CONFIRMATIONS,
//     chunkSize: env.SYNC_BLOCK_CHUNK_SIZE,
//     pollIntervalMs: env.SYNC_POLL_INTERVAL_MS,
//   };
// }