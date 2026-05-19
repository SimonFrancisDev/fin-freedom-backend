
import { ethers } from 'ethers';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedFinancialEvent from '../../models/IndexedFinancialEvent.js';

const RESPONSE_CACHE_TTL_MS = 15000;
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

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

function addReceiptFinancialAliases(receipt) {
  return {
    ...receipt,
    generatedGross: receipt.grossAmount,
    walletCreditedLiquid: receipt.liquidPaid,
    receiptEscrowLocked: receipt.escrowLocked,
    recyclePaidLiquid: Number(receipt.receiptType || 0) === 4 ? receipt.liquidPaid : '0',
    recycleEscrowLocked: Number(receipt.receiptType || 0) === 4 ? receipt.escrowLocked : '0',
    financialTruthSource: 'indexed_receipt_event',
  };
}

const reasonMessages = {
  ZERO_RECEIVER: {
    reason: 'No receiver was available for the expected payment.',
    action: 'Contact support for review.',
  },
  ZERO_AMOUNT: {
    reason: 'The expected payment amount was zero.',
    action: 'No user action is required.',
  },
  ID1_FALLBACK: {
    reason: 'No eligible receiver was found, so the value followed the ID1/founder fallback path.',
    action: 'Activate the required level to receive future routed payments.',
  },
  ESCROW_INSTEAD_OF_LIQUID: {
    reason: 'Part of the generated amount was locked for auto-upgrade instead of being credited as wallet-liquid payout.',
    action: 'No user action is required.',
  },
  RECYCLE_FALLBACK_ID1: {
    reason: 'No eligible recycle upline was found, so recycle routed to the ID1/founder path.',
    action: 'Activate the required level to remain eligible for future recycle routing.',
  },
  FOUNDER_ROUTE: {
    reason: 'The value was routed through the founder path.',
    action: 'No user action is required.',
  },
};

function explainFinancialEvent(event) {
  const mapped = reasonMessages[event.reasonCode] || {};
  return {
    ...event,
    reason: mapped.reason || event.reasonCode || '',
    recommendedAction: mapped.action || event.actionCode || '',
    generatedGross: event.expectedAmount || event.recycleGross || '0',
    walletCreditedLiquid: event.actualAmount || event.recycleLiquidPaid || '0',
    receiptEscrowLocked: event.recycleEscrowLocked || '0',
    recyclePaidLiquid: event.recycleLiquidPaid || '0',
    financialTruthSource: 'indexed_group3_financial_event',
  };
}

export async function fetchReceiptsByAddress(address, query = {}) {
  const normalizedAddress = normalizeAddress(address);

  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 25), 100);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    receiver: normalizedAddress,
  };

  const level = toOptionalNumber(query.level);
  if (level !== undefined) {
    mongoQuery.level = level;
  }

  const receiptType = toOptionalNumber(query.receiptType);
  if (receiptType !== undefined) {
    mongoQuery.receiptType = receiptType;
  }

  if (query.activationId !== undefined && query.activationId !== null && query.activationId !== '') {
    mongoQuery.activationId = String(query.activationId);
  }

  const cacheKey = `receipts-by-address:${normalizedAddress}:${JSON.stringify({
    page,
    limit,
    level: mongoQuery.level ?? null,
    receiptType: mongoQuery.receiptType ?? null,
    activationId: mongoQuery.activationId ?? null,
  })}`;

  return cached(cacheKey, async () => {
    const [items, total, skippedEvents] = await Promise.all([
      IndexedReceipt.find(mongoQuery)
        .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      IndexedReceipt.countDocuments(mongoQuery),
      IndexedFinancialEvent.find({
        eventName: 'PayoutNotDelivered',
        $or: [
          { affectedUser: normalizedAddress },
          { sourceUser: normalizedAddress },
          { actualReceiver: normalizedAddress },
        ],
      })
        .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
        .limit(25)
        .lean(),
    ]);

    return {
      data: items.map(addReceiptFinancialAliases),
      skippedPayments: skippedEvents.map(explainFinancialEvent),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  });
}

export async function fetchReceiptsByActivationId(activationId, query = {}) {
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 50), 200);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    activationId: String(activationId),
  };

  const cacheKey = `receipts-by-activation:${mongoQuery.activationId}:${JSON.stringify({
    page,
    limit,
  })}`;

  return cached(cacheKey, async () => {
    const [items, total, financialEvents] = await Promise.all([
      IndexedReceipt.find(mongoQuery)
        .sort({ timestamp: 1, blockNumber: 1, logIndex: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      IndexedReceipt.countDocuments(mongoQuery),
      IndexedFinancialEvent.find({
        activationId: mongoQuery.activationId,
        eventName: {
          $in: [
            'PayoutNotDelivered',
            'RecycleCompletedDetailed',
            'AutoUpgradeCompleted',
            'FounderDistributionDetailed',
            'SystemChargeDistributedDetailed',
          ],
        },
      })
        .sort({ timestamp: 1, blockNumber: 1, logIndex: 1 })
        .lean(),
    ]);

    return {
      data: items.map(addReceiptFinancialAliases),
      financialEvents: financialEvents.map(explainFinancialEvent),
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
// import IndexedReceipt from '../../models/IndexedReceipt.js';

// const RESPONSE_CACHE_TTL_MS = 15_000;
// const inflightCache = new Map();
// const responseCache = new Map();

// function cacheGet(key) {
//   const hit = responseCache.get(key);
//   if (!hit) return null;

//   if (Date.now() > hit.expiresAt) {
//     responseCache.delete(key);
//     return null;
//   }

//   return hit.value;
// }

// function cacheSet(key, value, ttlMs = RESPONSE_CACHE_TTL_MS) {
//   responseCache.set(key, {
//     value,
//     expiresAt: Date.now() + ttlMs,
//   });
// }

// async function cached(key, fn, ttlMs = RESPONSE_CACHE_TTL_MS) {
//   const existing = cacheGet(key);
//   if (existing) return existing;

//   if (inflightCache.has(key)) {
//     return inflightCache.get(key);
//   }

//   const promise = (async () => {
//     try {
//       const result = await fn();
//       cacheSet(key, result, ttlMs);
//       return result;
//     } finally {
//       inflightCache.delete(key);
//     }
//   })();

//   inflightCache.set(key, promise);
//   return promise;
// }

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

// function toOptionalNumber(value) {
//   if (value === undefined || value === null || value === '') return undefined;
//   const num = Number(value);
//   if (!Number.isFinite(num)) return undefined;
//   return num;
// }

// export async function fetchReceiptsByAddress(address, query = {}) {
//   const normalizedAddress = normalizeAddress(address);

//   const page = toPositiveInt(query.page, 1);
//   const limit = Math.min(toPositiveInt(query.limit, 25), 100);
//   const skip = (page - 1) * limit;

//   const mongoQuery = {
//     receiver: normalizedAddress,
//   };

//   const level = toOptionalNumber(query.level);
//   if (level !== undefined) {
//     mongoQuery.level = level;
//   }

//   const receiptType = toOptionalNumber(query.receiptType);
//   if (receiptType !== undefined) {
//     mongoQuery.receiptType = receiptType;
//   }

//   if (query.activationId) {
//     mongoQuery.activationId = String(query.activationId);
//   }

//   const cacheKey = `receipts-by-address:${normalizedAddress}:${JSON.stringify({
//     page,
//     limit,
//     level: mongoQuery.level ?? null,
//     receiptType: mongoQuery.receiptType ?? null,
//     activationId: mongoQuery.activationId ?? null,
//   })}`;

//   return cached(cacheKey, async () => {
//     const [items, total] = await Promise.all([
//       IndexedReceipt.find(mongoQuery)
//         .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       IndexedReceipt.countDocuments(mongoQuery),
//     ]);

//     return {
//       data: items,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit) || 1,
//       },
//     };
//   });
// }

// export async function fetchReceiptsByActivationId(activationId, query = {}) {
//   const page = toPositiveInt(query.page, 1);
//   const limit = Math.min(toPositiveInt(query.limit, 50), 200);
//   const skip = (page - 1) * limit;

//   const mongoQuery = {
//     activationId: String(activationId),
//   };

//   const cacheKey = `receipts-by-activation:${mongoQuery.activationId}:${JSON.stringify({
//     page,
//     limit,
//   })}`;

//   return cached(cacheKey, async () => {
//     const [items, total] = await Promise.all([
//       IndexedReceipt.find(mongoQuery)
//         .sort({ timestamp: 1, blockNumber: 1, logIndex: 1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       IndexedReceipt.countDocuments(mongoQuery),
//     ]);

//     return {
//       data: items,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit) || 1,
//       },
//     };
//   });
// }
