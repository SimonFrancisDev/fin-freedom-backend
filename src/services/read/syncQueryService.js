import SyncState from '../../models/SyncState.js';
import { getProvider, safeRpcCall } from '../../blockchain/provider.js';

const RESPONSE_CACHE_TTL_MS = 5000;
const inflightCache = new Map();
const responseCache = new Map();

function cacheGet(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;

  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }

  return hit.value;
}

function cacheSet(key, value, ttlMs = RESPONSE_CACHE_TTL_MS) {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function cached(key, fn, ttlMs = RESPONSE_CACHE_TTL_MS) {
  const existing = cacheGet(key);
  if (existing) return existing;

  if (inflightCache.has(key)) {
    return inflightCache.get(key);
  }

  const promise = (async () => {
    try {
      const result = await fn();
      cacheSet(key, result, ttlMs);
      return result;
    } finally {
      inflightCache.delete(key);
    }
  })();

  inflightCache.set(key, promise);
  return promise;
}

export async function fetchIndexerStatus() {
  return cached('sync:indexer-status', async () => {
    const provider = getProvider();

    const [latestBlock, syncStates] = await Promise.all([
      safeRpcCall(() => provider.getBlockNumber()).catch(() => 0),
      SyncState.find({})
        .sort({ key: 1 })
        .lean(),
    ]);

    return {
      latestBlock,
      syncStates,
    };
  });
}







// import SyncState from '../../models/SyncState.js';
// import { getProvider } from '../../blockchain/provider.js';

// export async function fetchIndexerStatus() {
//   const provider = getProvider();
//   const latestBlock = await provider.getBlockNumber();

//   const syncStates = await SyncState.find({})
//     .sort({ key: 1 })
//     .lean();

//   return {
//     latestBlock,
//     syncStates,
//   };
// }