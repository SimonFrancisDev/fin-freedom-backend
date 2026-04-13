import { ethers } from 'ethers';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';

const CACHE_TTL_MS = 10000;
const cache = new Map();
const inflight = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function cached(key, fn, ttlMs = CACHE_TTL_MS) {
  const existing = getCache(key);
  if (existing) return existing;

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      const result = await fn();
      setCache(key, result, ttlMs);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function normalizeAddress(address) {
  if (!ethers.isAddress(address)) {
    const error = new Error('Invalid wallet address');
    error.status = 400;
    throw error;
  }

  return address.toLowerCase();
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

export async function fetchOrbitEventsByAddress(address, query = {}) {
  const normalizedAddress = normalizeAddress(address);

  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 50), 200);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    $or: [{ orbitOwner: normalizedAddress }, { user: normalizedAddress }],
  };

  if (query.level) {
    mongoQuery.level = Number(query.level);
  }

  if (query.orbitType) {
    mongoQuery.orbitType = String(query.orbitType).toUpperCase();
  }

  if (query.eventName) {
    mongoQuery.eventName = String(query.eventName);
  }

  const cacheKey = `orbit-events:${normalizedAddress}:${JSON.stringify({
    page,
    limit,
    level: mongoQuery.level ?? null,
    orbitType: mongoQuery.orbitType ?? null,
    eventName: mongoQuery.eventName ?? null,
  })}`;

  return cached(cacheKey, async () => {
    const [items, total] = await Promise.all([
      IndexedOrbitEvent.find(mongoQuery)
        .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      IndexedOrbitEvent.countDocuments(mongoQuery),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  });
}














// import { ethers } from 'ethers';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';

// function normalizeAddress(address) {
//   if (!ethers.isAddress(address)) {
//     const error = new Error('Invalid wallet address');
//     error.status = 400;
//     throw error;
//   }

//   return address.toLowerCase();
// }

// function toPositiveInt(value, fallback) {
//   const num = Number(value);
//   if (!Number.isFinite(num) || num <= 0) return fallback;
//   return Math.floor(num);
// }

// export async function fetchOrbitEventsByAddress(address, query = {}) {
//   const normalizedAddress = normalizeAddress(address);

//   const page = toPositiveInt(query.page, 1);
//   const limit = Math.min(toPositiveInt(query.limit, 50), 200);
//   const skip = (page - 1) * limit;

//   const mongoQuery = {
//     $or: [
//       { orbitOwner: normalizedAddress },
//       { user: normalizedAddress },
//     ],
//   };

//   if (query.level) {
//     mongoQuery.level = Number(query.level);
//   }

//   if (query.orbitType) {
//     mongoQuery.orbitType = String(query.orbitType).toUpperCase();
//   }

//   if (query.eventName) {
//     mongoQuery.eventName = String(query.eventName);
//   }

//   const [items, total] = await Promise.all([
//     IndexedOrbitEvent.find(mongoQuery)
//       .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),
//     IndexedOrbitEvent.countDocuments(mongoQuery),
//   ]);

//   return {
//     data: items,
//     pagination: {
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit) || 1,
//     },
//   };
// }