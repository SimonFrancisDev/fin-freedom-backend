import { ethers } from 'ethers';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';

const CACHE_TTL_MS = 15000;
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

function dateKeyLocal(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRawUsdt(value) {
  try {
    return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
  } catch {
    return '0.00';
  }
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

function sumRawField(rows, fieldName) {
  return rows.reduce((acc, row) => {
    try {
      return acc + BigInt(row?.[fieldName] || '0');
    } catch {
      return acc;
    }
  }, 0n);
}

export async function fetchCommunityLeaderboard(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const cacheKey = `community-analytics:leaderboard:${safeLimit}`;

  return cached(cacheKey, async () => {
    const rows = await IndexedReceipt.find({})
      .select('receiver liquidPaid grossAmount escrowLocked')
      .lean();

    const grouped = new Map();

    for (const row of rows) {
      const receiver = String(row.receiver || '').toLowerCase();
      if (!receiver) continue;

      if (!grouped.has(receiver)) {
        grouped.set(receiver, {
          address: receiver,
          totalLiquid: 0n,
          totalGross: 0n,
          totalEscrow: 0n,
          receiptCount: 0,
        });
      }

      const current = grouped.get(receiver);
      current.totalLiquid += BigInt(row.liquidPaid || '0');
      current.totalGross += BigInt(row.grossAmount || '0');
      current.totalEscrow += BigInt(row.escrowLocked || '0');
      current.receiptCount += 1;
    }

    const sorted = Array.from(grouped.values())
      .sort((a, b) => {
        if (a.totalLiquid === b.totalLiquid) return b.receiptCount - a.receiptCount;
        return a.totalLiquid > b.totalLiquid ? -1 : 1;
      })
      .slice(0, safeLimit);

    return sorted.map((row, index) => ({
      rank: index + 1,
      address: row.address,
      totalEarned: formatRawUsdt(row.totalLiquid),
      totalGross: formatRawUsdt(row.totalGross),
      totalEscrow: formatRawUsdt(row.totalEscrow),
      receiptCount: row.receiptCount,
    }));
  });
}

export async function fetchCommunityGrowth(days = 14) {
  const safeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const since = daysAgo(safeDays);
  const cacheKey = `community-analytics:growth:${safeDays}`;

  return cached(cacheKey, async () => {
    const registrations = await IndexedRegistrationEvent.find({
      eventName: 'Registered',
      timestamp: { $gte: since },
    })
      .select('timestamp')
      .lean();

    const earnings = await IndexedReceipt.find({
      timestamp: { $gte: since },
    })
      .select('timestamp liquidPaid grossAmount')
      .lean();

    const registrationMap = new Map();
    const earningsMap = new Map();

    for (const row of registrations) {
      const key = dateKeyLocal(row.timestamp);
      registrationMap.set(key, (registrationMap.get(key) || 0) + 1);
    }

    for (const row of earnings) {
      const key = dateKeyLocal(row.timestamp);

      if (!earningsMap.has(key)) {
        earningsMap.set(key, {
          liquid: 0n,
          gross: 0n,
        });
      }

      const current = earningsMap.get(key);
      current.liquid += BigInt(row.liquidPaid || '0');
      current.gross += BigInt(row.grossAmount || '0');
    }

    const daysArray = [];
    for (let i = safeDays - 1; i >= 0; i -= 1) {
      const d = daysAgo(i);
      const key = dateKeyLocal(d);

      daysArray.push({
        date: key,
        registrations: registrationMap.get(key) || 0,
        earningsLiquid: formatRawUsdt(earningsMap.get(key)?.liquid || 0),
        earningsGross: formatRawUsdt(earningsMap.get(key)?.gross || 0),
      });
    }

    return {
      rangeDays: safeDays,
      series: daysArray,
    };
  });
}

export async function fetchCommunityGlobalStats() {
  return cached('community-analytics:global-stats', async () => {
    const [totalUsers, receiptRows] = await Promise.all([
      IndexedRegistrationEvent.countDocuments({
        eventName: 'Registered',
      }),
      IndexedReceipt.find({})
        .select('liquidPaid grossAmount escrowLocked')
        .lean(),
    ]);

    const totalLiquidRaw = sumRawField(receiptRows, 'liquidPaid');
    const totalGrossRaw = sumRawField(receiptRows, 'grossAmount');
    const totalEscrowRaw = sumRawField(receiptRows, 'escrowLocked');

    return {
      totalUsers,
      totalReceipts: receiptRows.length,
      totalLiquid: formatRawUsdt(totalLiquidRaw),
      totalGross: formatRawUsdt(totalGrossRaw),
      totalEscrow: formatRawUsdt(totalEscrowRaw),
    };
  });
}

export async function fetchTopReferrers(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const cacheKey = `community-analytics:top-referrers:${safeLimit}`;

  return cached(cacheKey, async () => {
    const pipeline = [
      {
        $match: {
          eventName: 'Registered',
          referrer: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: '$referrer',
          totalReferrals: { $sum: 1 },
          lastReferral: { $max: '$timestamp' },
        },
      },
      {
        $sort: { totalReferrals: -1, lastReferral: -1 },
      },
      {
        $limit: safeLimit,
      },
    ];

    const topReferrers = await IndexedRegistrationEvent.aggregate(pipeline);

    const enrichedReferrers = await Promise.all(
      topReferrers.map(async (ref, index) => {
        const address = ref._id;

        const referralEarnings = await IndexedReceipt.aggregate([
          {
            $match: {
              receiver: String(address).toLowerCase(),
              receiptType: 2,
            },
          },
          {
            $group: {
              _id: null,
              totalCommission: { $sum: { $toLong: '$liquidPaid' } },
              receiptCount: { $sum: 1 },
            },
          },
        ]);

        const earnings = referralEarnings[0] || { totalCommission: 0, receiptCount: 0 };

        return {
          rank: index + 1,
          address,
          totalReferrals: ref.totalReferrals,
          commissionEarned: formatRawUsdt(earnings.totalCommission || 0),
          referralReceipts: earnings.receiptCount,
          lastReferral: ref.lastReferral,
        };
      })
    );

    return enrichedReferrers;
  });
}

export async function fetchMostActive(limit = 20, days = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const sinceDate = daysAgo(safeDays);
  const cacheKey = `community-analytics:most-active:${safeLimit}:${safeDays}`;

  return cached(cacheKey, async () => {
    const pipeline = [
      {
        $match: {
          timestamp: { $gte: sinceDate },
        },
      },
      {
        $group: {
          _id: '$receiver',
          receiptCount: { $sum: 1 },
          totalVolume: { $sum: { $toLong: '$grossAmount' } },
          totalEarned: { $sum: { $toLong: '$liquidPaid' } },
          lastActive: { $max: '$timestamp' },
          uniqueSenders: { $addToSet: '$fromUser' },
        },
      },
      {
        $addFields: {
          uniqueSenderCount: { $size: '$uniqueSenders' },
        },
      },
      {
        $sort: {
          receiptCount: -1,
          totalVolume: -1,
          lastActive: -1,
        },
      },
      {
        $limit: safeLimit,
      },
    ];

    const activeUsers = await IndexedReceipt.aggregate(pipeline);

    const enrichedActive = await Promise.all(
      activeUsers.map(async (user, index) => {
        const registration = await IndexedRegistrationEvent.findOne({
          user: user._id,
          eventName: 'Registered',
        })
          .select('timestamp level')
          .lean();

        return {
          rank: index + 1,
          address: user._id,
          receiptCount: user.receiptCount,
          totalVolume: formatRawUsdt(user.totalVolume || 0),
          totalEarned: formatRawUsdt(user.totalEarned || 0),
          uniqueInteractions: user.uniqueSenderCount,
          lastActive: user.lastActive,
          registeredAt: registration?.timestamp || null,
          registeredLevel: registration?.level || 0,
        };
      })
    );

    return enrichedActive;
  });
}














// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';

// function dateKeyLocal(date) {
//   const d = new Date(date);
//   const y = d.getFullYear();
//   const m = String(d.getMonth() + 1).padStart(2, '0');
//   const day = String(d.getDate()).padStart(2, '0');
//   return `${y}-${m}-${day}`;
// }

// function formatRawUsdt(value) {
//   try {
//     return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
//   } catch {
//     return '0.00';
//   }
// }

// function startOfDay(date) {
//   const d = new Date(date);
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function daysAgo(n) {
//   const d = new Date();
//   d.setDate(d.getDate() - n);
//   return startOfDay(d);
// }

// function sumRawField(rows, fieldName) {
//   return rows.reduce((acc, row) => {
//     try {
//       return acc + BigInt(row?.[fieldName] || '0');
//     } catch {
//       return acc;
//     }
//   }, 0n);
// }

// /**
//  * =========================
//  * LEADERBOARD
//  * =========================
//  */
// export async function fetchCommunityLeaderboard(limit = 20) {
//   const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

//   const rows = await IndexedReceipt.find({})
//     .select('receiver liquidPaid grossAmount escrowLocked')
//     .lean();

//   const grouped = new Map();

//   for (const row of rows) {
//     const receiver = String(row.receiver || '').toLowerCase();
//     if (!receiver) continue;

//     if (!grouped.has(receiver)) {
//       grouped.set(receiver, {
//         address: receiver,
//         totalLiquid: 0n,
//         totalGross: 0n,
//         totalEscrow: 0n,
//         receiptCount: 0,
//       });
//     }

//     const current = grouped.get(receiver);
//     current.totalLiquid += BigInt(row.liquidPaid || '0');
//     current.totalGross += BigInt(row.grossAmount || '0');
//     current.totalEscrow += BigInt(row.escrowLocked || '0');
//     current.receiptCount += 1;
//   }

//   const sorted = Array.from(grouped.values())
//     .sort((a, b) => {
//       if (a.totalLiquid === b.totalLiquid) return b.receiptCount - a.receiptCount;
//       return a.totalLiquid > b.totalLiquid ? -1 : 1;
//     })
//     .slice(0, safeLimit);

//   return sorted.map((row, index) => ({
//     rank: index + 1,
//     address: row.address,
//     totalEarned: formatRawUsdt(row.totalLiquid),
//     totalGross: formatRawUsdt(row.totalGross),
//     totalEscrow: formatRawUsdt(row.totalEscrow),
//     receiptCount: row.receiptCount,
//   }));
// }

// /**
//  * =========================
//  * GROWTH STATS
//  * =========================
//  */
// export async function fetchCommunityGrowth(days = 14) {
//   const safeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
//   const since = daysAgo(safeDays);

//   console.log('--- Growth Debug ---');
//   console.log('server now (local):', new Date().toString());
//   console.log('server now (iso):', new Date().toISOString());
//   console.log('today local key:', dateKeyLocal(new Date()));
//   console.log('since local:', since.toString());
//   console.log('since key:', dateKeyLocal(since));
//   console.log('daysAgo(0) local:', daysAgo(0).toString());
//   console.log('daysAgo(0) key:', dateKeyLocal(daysAgo(0)));
//   console.log('daysAgo(1) local:', daysAgo(1).toString());
//   console.log('daysAgo(1) key:', dateKeyLocal(daysAgo(1)));

//   const registrations = await IndexedRegistrationEvent.find({
//     eventName: 'Registered',
//     timestamp: { $gte: since },
//   })
//     .select('timestamp')
//     .lean();

//   const earnings = await IndexedReceipt.find({
//     timestamp: { $gte: since },
//   })
//     .select('timestamp liquidPaid grossAmount')
//     .lean();

//   const registrationMap = new Map();
//   const earningsMap = new Map();

//   for (const row of registrations) {
//     const key = dateKeyLocal(row.timestamp);
//     registrationMap.set(key, (registrationMap.get(key) || 0) + 1);
//   }

//   for (const row of earnings) {
//     const key = dateKeyLocal(row.timestamp);

//     if (!earningsMap.has(key)) {
//       earningsMap.set(key, {
//         liquid: 0n,
//         gross: 0n,
//       });
//     }

//     const current = earningsMap.get(key);
//     current.liquid += BigInt(row.liquidPaid || '0');
//     current.gross += BigInt(row.grossAmount || '0');
//   }

//   const daysArray = [];
//   for (let i = safeDays - 1; i >= 0; i -= 1) {
//     const d = daysAgo(i);
//     const key = dateKeyLocal(d);

//     daysArray.push({
//       date: key,
//       registrations: registrationMap.get(key) || 0,
//       earningsLiquid: formatRawUsdt(earningsMap.get(key)?.liquid || 0),
//       earningsGross: formatRawUsdt(earningsMap.get(key)?.gross || 0),
//     });
//   }

//   console.log('growth final series:', daysArray);
//   console.log('--- End Growth Debug ---');

//   return {
//     rangeDays: safeDays,
//     series: daysArray,
//   };
// }

// /**
//  * =========================
//  * GLOBAL STATS
//  * =========================
//  */
// export async function fetchCommunityGlobalStats() {
//   const [totalUsers, receiptRows] = await Promise.all([
//     IndexedRegistrationEvent.countDocuments({
//       eventName: 'Registered',
//     }),
//     IndexedReceipt.find({})
//       .select('liquidPaid grossAmount escrowLocked')
//       .lean(),
//   ]);

//   const totalLiquidRaw = sumRawField(receiptRows, 'liquidPaid');
//   const totalGrossRaw = sumRawField(receiptRows, 'grossAmount');
//   const totalEscrowRaw = sumRawField(receiptRows, 'escrowLocked');

//   return {
//     totalUsers,
//     totalReceipts: receiptRows.length,
//     totalLiquid: formatRawUsdt(totalLiquidRaw),
//     totalGross: formatRawUsdt(totalGrossRaw),
//     totalEscrow: formatRawUsdt(totalEscrowRaw),
//   };
// }

// /**
//  * =========================
//  * TOP REFERRERS
//  * =========================
//  */
// export async function fetchTopReferrers(limit = 20) {
//   const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

//   // Aggregate referral counts from registration events
//   const pipeline = [
//     {
//       $match: {
//         eventName: 'Registered',
//         referrer: { $ne: null, $ne: '' }
//       }
//     },
//     {
//       $group: {
//         _id: '$referrer',
//         totalReferrals: { $sum: 1 },
//         lastReferral: { $max: '$timestamp' }
//       }
//     },
//     {
//       $sort: { totalReferrals: -1, lastReferral: -1 }
//     },
//     {
//       $limit: safeLimit
//     }
//   ];

//   const topReferrers = await IndexedRegistrationEvent.aggregate(pipeline);

//   // Get additional data for each referrer
//   const enrichedReferrers = await Promise.all(
//     topReferrers.map(async (ref, index) => {
//       const address = ref._id;

//       // Get their earnings from referrals (receiptType: 2)
//       const referralEarnings = await IndexedReceipt.aggregate([
//         {
//           $match: {
//             receiver: address.toLowerCase(),
//             receiptType: 2 // Referral commission type
//           }
//         },
//         {
//           $group: {
//             _id: null,
//             totalCommission: { $sum: { $toLong: '$liquidPaid' } },
//             receiptCount: { $sum: 1 }
//           }
//         }
//       ]);

//       const earnings = referralEarnings[0] || { totalCommission: 0, receiptCount: 0 };

//       return {
//         rank: index + 1,
//         address: address,
//         totalReferrals: ref.totalReferrals,
//         commissionEarned: formatRawUsdt(earnings.totalCommission || 0),
//         referralReceipts: earnings.receiptCount,
//         lastReferral: ref.lastReferral
//       };
//     })
//   );

//   return enrichedReferrers;
// }

// /**
//  * =========================
//  * MOST ACTIVE USERS
//  * =========================
//  */
// export async function fetchMostActive(limit = 20, days = 30) {
//   const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
//   const sinceDate = daysAgo(Number(days) || 30);

//   // Get users ranked by activity metrics
//   const pipeline = [
//     {
//       $match: {
//         timestamp: { $gte: sinceDate }
//       }
//     },
//     {
//       $group: {
//         _id: '$receiver',
//         receiptCount: { $sum: 1 },
//         totalVolume: { $sum: { $toLong: '$grossAmount' } },
//         totalEarned: { $sum: { $toLong: '$liquidPaid' } },
//         lastActive: { $max: '$timestamp' },
//         uniqueSenders: { $addToSet: '$fromUser' }
//       }
//     },
//     {
//       $addFields: {
//         uniqueSenderCount: { $size: '$uniqueSenders' }
//       }
//     },
//     {
//       $sort: {
//         receiptCount: -1,
//         totalVolume: -1,
//         lastActive: -1
//       }
//     },
//     {
//       $limit: safeLimit
//     }
//   ];

//   const activeUsers = await IndexedReceipt.aggregate(pipeline);

//   // Get registration info for each user
//   const enrichedActive = await Promise.all(
//     activeUsers.map(async (user, index) => {
//       const registration = await IndexedRegistrationEvent.findOne({
//         user: user._id,
//         eventName: 'Registered'
//       }).select('timestamp level').lean();

//       return {
//         rank: index + 1,
//         address: user._id,
//         receiptCount: user.receiptCount,
//         totalVolume: formatRawUsdt(user.totalVolume || 0),
//         totalEarned: formatRawUsdt(user.totalEarned || 0),
//         uniqueInteractions: user.uniqueSenderCount,
//         lastActive: user.lastActive,
//         registeredAt: registration?.timestamp || null,
//         registeredLevel: registration?.level || 0
//       };
//     })
//   );

//   return enrichedActive;
// }
