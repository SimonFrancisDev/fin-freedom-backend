import { JsonRpcProvider } from 'ethers';
import env from '../config/env.js';

let providerEntries = [];
let providerPointer = 0;

let activeRpcCalls = 0;
const waitQueue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const msg =
    String(error?.message || '') +
    ' ' +
    String(error?.shortMessage || '') +
    ' ' +
    String(error?.info?.responseStatus || '') +
    ' ' +
    String(error?.info?.responseBody || '');

  const lower = msg.toLowerCase();

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

function isTransientRpcError(error) {
  const msg =
    String(error?.message || '') +
    ' ' +
    String(error?.shortMessage || '') +
    ' ' +
    String(error?.info?.responseStatus || '') +
    ' ' +
    String(error?.info?.responseBody || '');

  const lower = msg.toLowerCase();

  return (
    isRateLimitError(error) ||
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
  }));

  return providerEntries;
}

function getHealthyProviderEntries() {
  initProviders();
  const now = Date.now();
  const healthy = providerEntries.filter((entry) => entry.cooldownUntil <= now);
  return healthy.length > 0 ? healthy : providerEntries;
}

function pickNextProviderEntry() {
  const healthy = getHealthyProviderEntries();
  const entry = healthy[providerPointer % healthy.length];
  providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;
  return entry;
}

function markProviderSuccess(entry) {
  entry.failures = 0;
  entry.cooldownUntil = 0;
  entry.lastError = '';
}

function markProviderFailure(entry, error) {
  entry.failures += 1;
  entry.lastError =
    error?.shortMessage ||
    error?.message ||
    error?.info?.responseStatus ||
    'Unknown RPC error';

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

      const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt), 10000);
      console.warn(
        `[RPC] ${entry.id} transient failure detected; retrying in ${waitMs}ms`
      );

      releaseRpcSlot();
      await sleep(waitMs);
      attempt += 1;
      continue;
    } finally {
      if (activeRpcCalls > 0) {
        releaseRpcSlot();
      }
    }
  }

  throw lastError || new Error('All RPC providers failed');
}

export async function connectBlockchain() {
  const network = await safeRpcCall((provider) => provider.getNetwork());
  const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
    providers: getProviderHealthSnapshot(),
  };
}













// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerInstance = null;

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
//     lower.includes('gateway timeout')
//   );
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
//   if (providerInstance) return providerInstance;

//   providerInstance = new JsonRpcProvider(
//     env.RPC_URL,
//     {
//       chainId: env.CHAIN_ID,
//       name: 'polygon-amoy',
//     },
//     {
//       staticNetwork: true,
//     }
//   );

//   return providerInstance;
// }

// export async function safeRpcCall(fn, retries = env.RPC_RETRY_ATTEMPTS, delayMs = env.RPC_RETRY_BASE_DELAY_MS) {
//   await acquireRpcSlot();

//   try {
//     return await fn();
//   } catch (err) {
//     if (!isTransientRpcError(err) || retries <= 0) {
//       throw err;
//     }

//     const waitMs = Math.min(delayMs, 10000);
//     console.warn(`[RPC] transient failure detected; retrying in ${waitMs}ms`);

//     await sleep(waitMs);

//     return safeRpcCall(fn, retries - 1, Math.min(delayMs * 2, 10000));
//   } finally {
//     releaseRpcSlot();
//   }
// }

// export async function connectBlockchain() {
//   const provider = getProvider();

//   const network = await safeRpcCall(() => provider.getNetwork());
//   const blockNumber = await safeRpcCall(() => provider.getBlockNumber());

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//   };
// }