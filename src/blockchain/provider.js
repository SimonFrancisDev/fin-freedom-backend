import { JsonRpcProvider } from 'ethers';
import env from '../config/env.js';

let providerInstance = null;

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
    lower.includes('gateway timeout')
  );
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
  if (providerInstance) return providerInstance;

  providerInstance = new JsonRpcProvider(
    env.RPC_URL,
    {
      chainId: env.CHAIN_ID,
      name: 'polygon-amoy',
    },
    {
      staticNetwork: true,
    }
  );

  return providerInstance;
}

export async function safeRpcCall(fn, retries = env.RPC_RETRY_ATTEMPTS, delayMs = env.RPC_RETRY_BASE_DELAY_MS) {
  await acquireRpcSlot();

  try {
    return await fn();
  } catch (err) {
    if (!isTransientRpcError(err) || retries <= 0) {
      throw err;
    }

    const waitMs = Math.min(delayMs, 10000);
    console.warn(`[RPC] transient failure detected; retrying in ${waitMs}ms`);

    await sleep(waitMs);

    return safeRpcCall(fn, retries - 1, Math.min(delayMs * 2, 10000));
  } finally {
    releaseRpcSlot();
  }
}

export async function connectBlockchain() {
  const provider = getProvider();

  const network = await safeRpcCall(() => provider.getNetwork());
  const blockNumber = await safeRpcCall(() => provider.getBlockNumber());

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
  };
}


















// import { JsonRpcProvider } from 'ethers'
// import env from '../config/env.js'

// let providerInstance = null

// export function getProvider() {
//   if (providerInstance) return providerInstance

//   providerInstance = new JsonRpcProvider(env.RPC_URL, {
//     chainId: env.CHAIN_ID,
//     name: 'polygon-amoy',
//     staticNetwork: true
//   })

//   return providerInstance
// }

// // 🔥 SAFE RPC CALL WRAPPER (GLOBAL PROTECTION)
// export async function safeRpcCall(fn, retries = 3, delayMs = 1500) {
//   try {
//     return await fn()
//   } catch (err) {
//     const msg = String(err?.message || '').toLowerCase()

//     const isRateLimit =
//       msg.includes('429') ||
//       msg.includes('rate limit') ||
//       msg.includes('too many requests') ||
//       msg.includes('1015')

//     if (!isRateLimit || retries <= 0) {
//       throw err
//     }

//     console.warn(`[RPC] Rate limited. Retrying in ${delayMs}ms...`)

//     await new Promise(r => setTimeout(r, delayMs))

//     return safeRpcCall(fn, retries - 1, Math.min(delayMs * 2, 10000))
//   }
// }

// export async function connectBlockchain() {
//   const provider = getProvider()

//   const network = await safeRpcCall(() => provider.getNetwork())
//   const blockNumber = await safeRpcCall(() => provider.getBlockNumber())

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//   }
// }
