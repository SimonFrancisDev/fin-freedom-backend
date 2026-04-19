import { JsonRpcProvider } from 'ethers';
import env from '../config/env.js';

let providerEntries = [];
let providerPointer = 0;

let activeRpcCalls = 0;
const waitQueue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildErrorMessage(error) {
  return (
    String(error?.message || '') +
    ' ' +
    String(error?.shortMessage || '') +
    ' ' +
    String(error?.info?.responseStatus || '') +
    ' ' +
    String(error?.info?.responseBody || '')
  ).trim();
}

function isRateLimitError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('429') ||
    lower.includes('1015') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('throughput') ||
    lower.includes('compute units per second') ||
    lower.includes('exceeded maximum retry limit')
  );
}

function isOutOfCreditsError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('402') ||
    lower.includes('payment required') ||
    lower.includes('out of cu') ||
    lower.includes('out of credits') ||
    lower.includes('billing') ||
    lower.includes('quota exceeded')
  );
}

function isTransientRpcError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    isRateLimitError(error) ||
    isOutOfCreditsError(error) ||
    lower.includes('timeout') ||
    lower.includes('socket hang up') ||
    lower.includes('network error') ||
    lower.includes('failed to detect network') ||
    lower.includes('missing response') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout') ||
    lower.includes('server error')
  );
}

function initProviders() {
  if (providerEntries.length > 0) return providerEntries;

  providerEntries = env.RPC_URLS.map((url, index) => ({
    id: `rpc-${index + 1}`,
    url,
    provider: new JsonRpcProvider(
      url,
      {
        chainId: env.CHAIN_ID,
        name: `chain-${env.CHAIN_ID}`,
      },
      {
        staticNetwork: true,
      }
    ),
    failures: 0,
    cooldownUntil: 0,
    lastError: '',
    successCount: 0,
  }));

  return providerEntries;
}

function getHealthyProviderEntries() {
  initProviders();
  const now = Date.now();

  const healthy = providerEntries.filter(
    (entry) => entry.cooldownUntil <= now
  );

  return healthy.length > 0 ? healthy : providerEntries;
}

function pickNextProviderEntry() {
  const healthy = getHealthyProviderEntries();

  // round robin but prefer less failed providers
  healthy.sort((a, b) => a.failures - b.failures);

  const entry = healthy[providerPointer % healthy.length];
  providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;

  return entry;
}

function markProviderSuccess(entry) {
  entry.failures = 0;
  entry.cooldownUntil = 0;
  entry.lastError = '';
  entry.successCount += 1;
}

function markProviderFailure(entry, error) {
  entry.failures += 1;
  entry.lastError =
    error?.shortMessage ||
    error?.message ||
    error?.info?.responseStatus ||
    'Unknown RPC error';

  if (isOutOfCreditsError(error)) {
    entry.cooldownUntil = Date.now() + env.RPC_OUT_OF_CREDITS_COOLDOWN_MS;
    return;
  }

  const cooldownMs = Math.min(2000 * entry.failures, 15000);
  entry.cooldownUntil = Date.now() + cooldownMs;
}

async function acquireRpcSlot() {
  if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
    activeRpcCalls += 1;
    return;
  }

  await new Promise((resolve) => {
    waitQueue.push(resolve);
  });

  activeRpcCalls += 1;
}

function releaseRpcSlot() {
  activeRpcCalls = Math.max(0, activeRpcCalls - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export function getProvider() {
  return pickNextProviderEntry().provider;
}

export function getProviderHealthSnapshot() {
  initProviders();

  return providerEntries.map((entry) => ({
    id: entry.id,
    url: entry.url,
    failures: entry.failures,
    successCount: entry.successCount,
    cooldownUntil: entry.cooldownUntil,
    coolingDown: entry.cooldownUntil > Date.now(),
    lastError: entry.lastError,
  }));
}

export async function safeRpcCall(
  fn,
  retries = env.RPC_RETRY_ATTEMPTS,
  baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    await acquireRpcSlot();

    const entry = pickNextProviderEntry();
    let releasedEarly = false;

    try {
      const result = await fn(entry.provider, entry);
      markProviderSuccess(entry);
      return result;
    } catch (err) {
      lastError = err;

      if (!isTransientRpcError(err)) {
        throw err;
      }

      markProviderFailure(entry, err);

      if (attempt >= retries) {
        break;
      }

      const waitMs = isOutOfCreditsError(err)
        ? env.RPC_OUT_OF_CREDITS_COOLDOWN_MS
        : Math.min(baseDelayMs * Math.pow(2, attempt), 10000);

      if (env.LOG_LEVEL === 'debug') {
        console.warn(
          `[RPC] ${entry.id} retry ${attempt + 1}/${retries} after ${waitMs}ms`,
          buildErrorMessage(err)
        );
      }

      releaseRpcSlot();
      releasedEarly = true;

      await sleep(waitMs);
      attempt += 1;
      continue;
    } finally {
      if (!releasedEarly && activeRpcCalls > 0) {
        releaseRpcSlot();
      }
    }
  }

  throw lastError || new Error('All RPC providers failed');
}

export async function connectBlockchain() {
  const network = await safeRpcCall((provider) => provider.getNetwork());
  const blockNumber = await safeRpcCall((provider) =>
    provider.getBlockNumber()
  );

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
    providers: getProviderHealthSnapshot(),
  };
}












//======================
//  SECOND VERSION
//=====================
// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerEntries = [];
// let providerPointer = 0;

// let activeRpcCalls = 0;
// const waitQueue = [];

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function buildErrorMessage(error) {
//   return (
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '')
//   ).trim();
// }

// function isRateLimitError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
//     lower.includes('exceeded maximum retry limit')
//   );
// }

// function isOutOfCreditsError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('402') ||
//     lower.includes('payment required') ||
//     lower.includes('out of cu') ||
//     lower.includes('out of credits') ||
//     lower.includes('billing') ||
//     lower.includes('quota exceeded')
//   );
// }

// function isTransientRpcError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     isRateLimitError(error) ||
//     isOutOfCreditsError(error) ||
//     lower.includes('timeout') ||
//     lower.includes('socket hang up') ||
//     lower.includes('network error') ||
//     lower.includes('failed to detect network') ||
//     lower.includes('missing response') ||
//     lower.includes('bad gateway') ||
//     lower.includes('gateway timeout') ||
//     lower.includes('server error')
//   );
// }

// function initProviders() {
//   if (providerEntries.length > 0) return providerEntries;

//   providerEntries = env.RPC_URLS.map((url, index) => ({
//     id: `rpc-${index + 1}`,
//     url,
//     provider: new JsonRpcProvider(
//       url,
//       {
//         chainId: env.CHAIN_ID,
//         name: `chain-${env.CHAIN_ID}`,
//       },
//       {
//         staticNetwork: true,
//       }
//     ),
//     failures: 0,
//     cooldownUntil: 0,
//     lastError: '',
//   }));

//   return providerEntries;
// }

// function getHealthyProviderEntries() {
//   initProviders();
//   const now = Date.now();
//   const healthy = providerEntries.filter((entry) => entry.cooldownUntil <= now);
//   return healthy.length > 0 ? healthy : providerEntries;
// }

// function pickNextProviderEntry() {
//   const healthy = getHealthyProviderEntries();
//   const entry = healthy[providerPointer % healthy.length];
//   providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;
//   return entry;
// }

// function markProviderSuccess(entry) {
//   entry.failures = 0;
//   entry.cooldownUntil = 0;
//   entry.lastError = '';
// }

// function markProviderFailure(entry, error) {
//   entry.failures += 1;
//   entry.lastError =
//     error?.shortMessage ||
//     error?.message ||
//     error?.info?.responseStatus ||
//     'Unknown RPC error';

//   if (isOutOfCreditsError(error)) {
//     entry.cooldownUntil = Date.now() + env.RPC_OUT_OF_CREDITS_COOLDOWN_MS;
//     return;
//   }

//   const cooldownMs = Math.min(2000 * entry.failures, 15000);
//   entry.cooldownUntil = Date.now() + cooldownMs;
// }

// async function acquireRpcSlot() {
//   if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
//     activeRpcCalls += 1;
//     return;
//   }

//   await new Promise((resolve) => {
//     waitQueue.push(resolve);
//   });

//   activeRpcCalls += 1;
// }

// function releaseRpcSlot() {
//   activeRpcCalls = Math.max(0, activeRpcCalls - 1);
//   const next = waitQueue.shift();
//   if (next) next();
// }

// export function getProvider() {
//   return pickNextProviderEntry().provider;
// }

// export function getProviderHealthSnapshot() {
//   initProviders();

//   return providerEntries.map((entry) => ({
//     id: entry.id,
//     url: entry.url,
//     failures: entry.failures,
//     cooldownUntil: entry.cooldownUntil,
//     coolingDown: entry.cooldownUntil > Date.now(),
//     lastError: entry.lastError,
//   }));
// }

// export async function safeRpcCall(
//   fn,
//   retries = env.RPC_RETRY_ATTEMPTS,
//   baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
// ) {
//   let attempt = 0;
//   let lastError = null;

//   while (attempt <= retries) {
//     await acquireRpcSlot();

//     const entry = pickNextProviderEntry();
//     let releasedEarly = false;

//     try {
//       const result = await fn(entry.provider, entry);
//       markProviderSuccess(entry);
//       return result;
//     } catch (err) {
//       lastError = err;

//       if (!isTransientRpcError(err)) {
//         throw err;
//       }

//       markProviderFailure(entry, err);

//       if (attempt >= retries) {
//         break;
//       }

//       const waitMs = isOutOfCreditsError(err)
//         ? env.RPC_OUT_OF_CREDITS_COOLDOWN_MS
//         : Math.min(baseDelayMs * Math.pow(2, attempt), 10000);

//       if (isOutOfCreditsError(err)) {
//         console.warn(
//           `[RPC] ${entry.id} exhausted or out of credits; cooling down for ${waitMs}ms`
//         );
//       } else {
//         console.warn(
//           `[RPC] ${entry.id} transient failure detected; retrying in ${waitMs}ms`
//         );
//       }

//       releaseRpcSlot();
//       releasedEarly = true;

//       await sleep(waitMs);
//       attempt += 1;
//       continue;
//     } finally {
//       if (!releasedEarly && activeRpcCalls > 0) {
//         releaseRpcSlot();
//       }
//     }
//   }

//   throw lastError || new Error('All RPC providers failed');
// }

// export async function connectBlockchain() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//     providers: getProviderHealthSnapshot(),
//   };
// }










//========================================
// FIRST VERSION
//========================================
// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerEntries = [];
// let providerPointer = 0;

// let activeRpcCalls = 0;
// const waitQueue = [];

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function isRateLimitError(error) {
//   const msg =
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '');

//   const lower = msg.toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
//     lower.includes('exceeded maximum retry limit')
//   );
// }

// function isTransientRpcError(error) {
//   const msg =
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '');

//   const lower = msg.toLowerCase();

//   return (
//     isRateLimitError(error) ||
//     lower.includes('timeout') ||
//     lower.includes('socket hang up') ||
//     lower.includes('network error') ||
//     lower.includes('failed to detect network') ||
//     lower.includes('missing response') ||
//     lower.includes('bad gateway') ||
//     lower.includes('gateway timeout') ||
//     lower.includes('server error')
//   );
// }

// function initProviders() {
//   if (providerEntries.length > 0) return providerEntries;

//   providerEntries = env.RPC_URLS.map((url, index) => ({
//     id: `rpc-${index + 1}`,
//     url,
//     provider: new JsonRpcProvider(
//       url,
//       {
//         chainId: env.CHAIN_ID,
//         name: `chain-${env.CHAIN_ID}`,
//       },
//       {
//         staticNetwork: true,
//       }
//     ),
//     failures: 0,
//     cooldownUntil: 0,
//     lastError: '',
//   }));

//   return providerEntries;
// }

// function getHealthyProviderEntries() {
//   initProviders();
//   const now = Date.now();
//   const healthy = providerEntries.filter((entry) => entry.cooldownUntil <= now);
//   return healthy.length > 0 ? healthy : providerEntries;
// }

// function pickNextProviderEntry() {
//   const healthy = getHealthyProviderEntries();
//   const entry = healthy[providerPointer % healthy.length];
//   providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;
//   return entry;
// }

// function markProviderSuccess(entry) {
//   entry.failures = 0;
//   entry.cooldownUntil = 0;
//   entry.lastError = '';
// }

// function markProviderFailure(entry, error) {
//   entry.failures += 1;
//   entry.lastError =
//     error?.shortMessage ||
//     error?.message ||
//     error?.info?.responseStatus ||
//     'Unknown RPC error';

//   const cooldownMs = Math.min(2000 * entry.failures, 15000);
//   entry.cooldownUntil = Date.now() + cooldownMs;
// }

// async function acquireRpcSlot() {
//   if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
//     activeRpcCalls += 1;
//     return;
//   }

//   await new Promise((resolve) => {
//     waitQueue.push(resolve);
//   });

//   activeRpcCalls += 1;
// }

// function releaseRpcSlot() {
//   activeRpcCalls = Math.max(0, activeRpcCalls - 1);
//   const next = waitQueue.shift();
//   if (next) next();
// }

// export function getProvider() {
//   return pickNextProviderEntry().provider;
// }

// export function getProviderHealthSnapshot() {
//   initProviders();

//   return providerEntries.map((entry) => ({
//     id: entry.id,
//     url: entry.url,
//     failures: entry.failures,
//     cooldownUntil: entry.cooldownUntil,
//     coolingDown: entry.cooldownUntil > Date.now(),
//     lastError: entry.lastError,
//   }));
// }

// export async function safeRpcCall(
//   fn,
//   retries = env.RPC_RETRY_ATTEMPTS,
//   baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
// ) {
//   let attempt = 0;
//   let lastError = null;

//   while (attempt <= retries) {
//     await acquireRpcSlot();

//     const entry = pickNextProviderEntry();

//     try {
//       const result = await fn(entry.provider, entry);
//       markProviderSuccess(entry);
//       return result;
//     } catch (err) {
//       lastError = err;

//       if (!isTransientRpcError(err)) {
//         throw err;
//       }

//       markProviderFailure(entry, err);

//       if (attempt >= retries) {
//         break;
//       }

//       const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt), 10000);
//       console.warn(
//         `[RPC] ${entry.id} transient failure detected; retrying in ${waitMs}ms`
//       );

//       releaseRpcSlot();
//       await sleep(waitMs);
//       attempt += 1;
//       continue;
//     } finally {
//       if (activeRpcCalls > 0) {
//         releaseRpcSlot();
//       }
//     }
//   }

//   throw lastError || new Error('All RPC providers failed');
// }

// export async function connectBlockchain() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//     providers: getProviderHealthSnapshot(),
//   };
// }
