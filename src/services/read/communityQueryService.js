import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
import CommunityEvent from '../../models/CommunityEvent.js';
import CommunitySocialLink from '../../models/CommunitySocialLink.js';
import CommunityResource from '../../models/CommunityResource.js';
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

function formatUsdt(value) {
  try {
    return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
  } catch {
    return '0.00';
  }
}

function getContractAddress(contract) {
  return contract?.target || contract?.address || '';
}

async function safeBalanceOf(usdtContract, address) {
  if (!usdtContract?.balanceOf || !address) return 0n;
  try {
    const value = await safeRpcCall(() => usdtContract.balanceOf(address));
    return BigInt(value || 0);
  } catch {
    return 0n;
  }
}

async function fetchTotalParticipants(contracts) {
  if (!contracts?.registration) return 0;

  try {
    const totalParticipantsRaw = await safeRpcCall(() => contracts.registration.totalParticipants());
    const count = Number(totalParticipantsRaw || 0);
    if (count > 0) return count;
  } catch {
    // fall back
  }

  try {
    return await IndexedRegistrationEvent.countDocuments({
      eventName: 'Registered',
    });
  } catch {
    return 0;
  }
}

async function fetchVisibleCoreBalance(contracts) {
  let totalCommunityValueRaw = 0n;

  try {
    const receipts = await IndexedReceipt.find({})
      .select('grossAmount')
      .lean();

    totalCommunityValueRaw = receipts.reduce((acc, receipt) => {
      try {
        return acc + BigInt(receipt.grossAmount || '0');
      } catch {
        return acc;
      }
    }, 0n);
  } catch {
    totalCommunityValueRaw = 0n;
  }

  let onChainBalanceRaw = 0n;
  const usdtContract = contracts?.usdt;

  if (usdtContract) {
    const escrowAddress = getContractAddress(contracts.escrow);
    const p4Address = getContractAddress(contracts.p4Orbit);
    const p12Address = getContractAddress(contracts.p12Orbit);
    const p39Address = getContractAddress(contracts.p39Orbit);

    try {
      const [escrowRaw, p4Raw, p12Raw, p39Raw] = await Promise.all([
        safeBalanceOf(usdtContract, escrowAddress),
        safeBalanceOf(usdtContract, p4Address),
        safeBalanceOf(usdtContract, p12Address),
        safeBalanceOf(usdtContract, p39Address),
      ]);

      onChainBalanceRaw =
        BigInt(escrowRaw || 0) +
        BigInt(p4Raw || 0) +
        BigInt(p12Raw || 0) +
        BigInt(p39Raw || 0);
    } catch {
      onChainBalanceRaw = 0n;
    }
  }

  return totalCommunityValueRaw > onChainBalanceRaw
    ? totalCommunityValueRaw
    : onChainBalanceRaw;
}

export async function fetchCommunitySummary() {
  return cached('community:summary', async () => {
    const contracts = getContracts();

    const [totalParticipants, visibleCoreBalanceRaw, announcementCount, eventCount, socialCount, resourceCount, receiptCount] =
      await Promise.all([
        fetchTotalParticipants(contracts),
        fetchVisibleCoreBalance(contracts),
        CommunityAnnouncement.countDocuments({ isActive: true }).catch(() => 0),
        CommunityEvent.countDocuments({ isActive: true }).catch(() => 0),
        CommunitySocialLink.countDocuments({ isActive: true }).catch(() => 0),
        CommunityResource.countDocuments({ isActive: true }).catch(() => 0),
        IndexedReceipt.countDocuments().catch(() => 0),
      ]);

    return {
      public: {
        totalParticipants,
        visibleCoreBalanceUsdt: formatUsdt(visibleCoreBalanceRaw),
        readLayerStatus: totalParticipants > 0 ? 'Live' : 'Syncing',
      },
      feeds: {
        announcements: announcementCount > 0 ? 'live' : 'unavailable',
        events: eventCount > 0 ? 'live' : 'unavailable',
        socialLinks: socialCount > 0 ? 'live' : 'unavailable',
        resources: resourceCount > 0 ? 'live' : 'unavailable',
        leaderboard: receiptCount > 0 ? 'live' : 'unavailable',
        growth: totalParticipants > 0 ? 'live' : 'unavailable',
      },
    };
  });
}

export async function fetchCommunityAnnouncements() {
  return cached('community:announcements', async () => {
    const items = await CommunityAnnouncement.find({ isActive: true })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    return {
      status: items.length ? 'live' : 'unavailable',
      items,
    };
  });
}

export async function fetchCommunityEvents() {
  return cached('community:events', async () => {
    const items = await CommunityEvent.find({ isActive: true })
      .sort({ priority: -1, startAt: 1, createdAt: -1 })
      .lean();

    return {
      status: items.length ? 'live' : 'unavailable',
      items,
    };
  });
}

export async function fetchCommunitySocialLinks() {
  return cached('community:social-links', async () => {
    const items = await CommunitySocialLink.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return {
      status: items.length ? 'live' : 'unavailable',
      items,
    };
  });
}

export async function fetchCommunityResources() {
  return cached('community:resources', async () => {
    const items = await CommunityResource.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return {
      status: items.length ? 'live' : 'unavailable',
      items,
    };
  });
}















// import { ethers } from 'ethers';
// import { getContracts } from '../../blockchain/contracts.js';
// import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
// import CommunityEvent from '../../models/CommunityEvent.js';
// import CommunitySocialLink from '../../models/CommunitySocialLink.js';
// import CommunityResource from '../../models/CommunityResource.js';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';



// function formatUsdt(value) {
//   try {
//     return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
//   } catch {
//     return '0.00';
//   }
// }

// function getContractAddress(contract) {
//   return contract?.target || contract?.address || '';
// }

// async function safeBalanceOf(usdtContract, address) {
//   if (!usdtContract?.balanceOf || !address) return 0n;
//   try {
//     return BigInt(await usdtContract.balanceOf(address));
//   } catch (error) {
//     console.error(`balanceOf failed for ${address}:`, error);
//     return 0n;
//   }
// }

// // export async function fetchCommunitySummary() {
// //   const contracts = getContracts();

// //   if (!contracts?.registration) {
// //     const error = new Error('Registration contract is not available');
// //     error.status = 500;
// //     throw error;
// //   }

// //   if (!contracts?.usdt) {
// //     const error = new Error('USDT contract is not available');
// //     error.status = 500;
// //     throw error;
// //   }

// //   const escrowAddress = getContractAddress(contracts.escrow);
// //   const p4Address = getContractAddress(contracts.p4Orbit);
// //   const p12Address = getContractAddress(contracts.p12Orbit);
// //   const p39Address = getContractAddress(contracts.p39Orbit);

// //   const [
// //     totalParticipantsRaw,
// //     escrowRaw,
// //     p4Raw,
// //     p12Raw,
// //     p39Raw,
// //     announcementCount,
// //     eventCount,
// //     socialCount,
// //     resourceCount,
// //   ] = await Promise.all([
// //     contracts.registration.totalParticipants().catch(() => 0),
// //     safeBalanceOf(contracts.usdt, escrowAddress),
// //     safeBalanceOf(contracts.usdt, p4Address),
// //     safeBalanceOf(contracts.usdt, p12Address),
// //     safeBalanceOf(contracts.usdt, p39Address),
// //     CommunityAnnouncement.countDocuments({ isActive: true }),
// //     CommunityEvent.countDocuments({ isActive: true }),
// //     CommunitySocialLink.countDocuments({ isActive: true }),
// //     CommunityResource.countDocuments({ isActive: true }),
// //   ]);

// //   const totalParticipants = Number(totalParticipantsRaw || 0);
// //   const totalVisibleBalanceRaw =
// //     BigInt(escrowRaw || 0) +
// //     BigInt(p4Raw || 0) +
// //     BigInt(p12Raw || 0) +
// //     BigInt(p39Raw || 0);

// //   return {
// //     public: {
// //       totalParticipants,
// //       visibleCoreBalanceUsdt: formatUsdt(totalVisibleBalanceRaw),
// //       readLayerStatus: 'Live',
// //     },
// //     feeds: {
// //       announcements: announcementCount > 0 ? 'live' : 'unavailable',
// //       events: eventCount > 0 ? 'live' : 'unavailable',
// //       socialLinks: socialCount > 0 ? 'live' : 'unavailable',
// //       resources: resourceCount > 0 ? 'live' : 'unavailable',
// //       leaderboard: 'unavailable',
// //       growth: 'unavailable',
// //     },
// //   };
// // }

// export async function fetchCommunitySummary() {
//   const contracts = getContracts();

//   // Get total participants from registration contract
//   let totalParticipants = 0;
//   if (contracts?.registration) {
//     try {
//       const totalParticipantsRaw = await contracts.registration.totalParticipants().catch(() => 0);
//       totalParticipants = Number(totalParticipantsRaw || 0);
//     } catch (error) {
//       console.error('Failed to fetch total participants from contract:', error);
//     }
//   }

//   // If contract returns 0, try getting from database
//   if (totalParticipants === 0) {
//     try {
//       totalParticipants = await IndexedRegistrationEvent.countDocuments({ 
//         eventName: 'Registered' 
//       });
//     } catch (error) {
//       console.error('Failed to fetch registration count from DB:', error);
//     }
//   }

//   // Calculate total community value from receipts (all-time gross amount)
//   let totalCommunityValueRaw = 0n;
//   try {
//     const receipts = await IndexedReceipt.find({}).select('grossAmount').lean();
//     totalCommunityValueRaw = receipts.reduce((acc, receipt) => {
//       try {
//         return acc + BigInt(receipt.grossAmount || '0');
//       } catch {
//         return acc;
//       }
//     }, 0n);
//     console.log(`📊 Total community value from receipts: ${totalCommunityValueRaw}`);
//   } catch (error) {
//     console.error('Failed to calculate total community value from receipts:', error);
//   }

//   // Also get current on-chain balances as supplementary data
//   let onChainBalanceRaw = 0n;
//   const usdtContract = contracts?.usdt || contracts?.fgtToken;
  
//   if (usdtContract) {
//     const escrowAddress = getContractAddress(contracts.escrow);
//     const p4Address = getContractAddress(contracts.p4Orbit);
//     const p12Address = getContractAddress(contracts.p12Orbit);
//     const p39Address = getContractAddress(contracts.p39Orbit);

//     try {
//       const [escrowRaw, p4Raw, p12Raw, p39Raw] = await Promise.all([
//         safeBalanceOf(usdtContract, escrowAddress).catch(() => 0n),
//         safeBalanceOf(usdtContract, p4Address).catch(() => 0n),
//         safeBalanceOf(usdtContract, p12Address).catch(() => 0n),
//         safeBalanceOf(usdtContract, p39Address).catch(() => 0n),
//       ]);

//       onChainBalanceRaw = 
//         BigInt(escrowRaw || 0) + 
//         BigInt(p4Raw || 0) + 
//         BigInt(p12Raw || 0) + 
//         BigInt(p39Raw || 0);
      
//       console.log(`💰 On-chain contract balances: ${onChainBalanceRaw}`);
//     } catch (error) {
//       console.error('Failed to fetch on-chain balances:', error);
//     }
//   }

//   // Use the larger of the two values (receipts total or on-chain balance)
//   const visibleCoreBalanceRaw = totalCommunityValueRaw > onChainBalanceRaw 
//     ? totalCommunityValueRaw 
//     : onChainBalanceRaw;

//   // Get community content counts
//   let announcementCount = 0, eventCount = 0, socialCount = 0, resourceCount = 0;
//   try {
//     [announcementCount, eventCount, socialCount, resourceCount] = await Promise.all([
//       CommunityAnnouncement.countDocuments({ isActive: true }).catch(() => 0),
//       CommunityEvent.countDocuments({ isActive: true }).catch(() => 0),
//       CommunitySocialLink.countDocuments({ isActive: true }).catch(() => 0),
//       CommunityResource.countDocuments({ isActive: true }).catch(() => 0),
//     ]);
//   } catch (error) {
//     console.error('Failed to fetch community content counts:', error);
//   }

//   // Check if leaderboard has data
//   let leaderboardStatus = 'unavailable';
//   try {
//     const receiptCount = await IndexedReceipt.countDocuments();
//     leaderboardStatus = receiptCount > 0 ? 'live' : 'unavailable';
//   } catch (error) {
//     console.error('Failed to check leaderboard status:', error);
//   }

//   return {
//     public: {
//       totalParticipants,
//       visibleCoreBalanceUsdt: formatUsdt(visibleCoreBalanceRaw),
//       readLayerStatus: totalParticipants > 0 ? 'Live' : 'Syncing',
//     },
//     feeds: {
//       announcements: announcementCount > 0 ? 'live' : 'unavailable',
//       events: eventCount > 0 ? 'live' : 'unavailable',
//       socialLinks: socialCount > 0 ? 'live' : 'unavailable',
//       resources: resourceCount > 0 ? 'live' : 'unavailable',
//       leaderboard: leaderboardStatus,
//       growth: totalParticipants > 0 ? 'live' : 'unavailable',
//     },
//   };
// }



// export async function fetchCommunityAnnouncements() {
//   const items = await CommunityAnnouncement.find({ isActive: true })
//     .sort({ priority: -1, createdAt: -1 })
//     .lean();

//   return {
//     status: items.length ? 'live' : 'unavailable',
//     items,
//   };
// }

// export async function fetchCommunityEvents() {
//   const items = await CommunityEvent.find({ isActive: true })
//     .sort({ priority: -1, startAt: 1, createdAt: -1 })
//     .lean();

//   return {
//     status: items.length ? 'live' : 'unavailable',
//     items,
//   };
// }

// export async function fetchCommunitySocialLinks() {
//   const items = await CommunitySocialLink.find({ isActive: true })
//     .sort({ sortOrder: 1, createdAt: 1 })
//     .lean();

//   return {
//     status: items.length ? 'live' : 'unavailable',
//     items,
//   };
// }

// export async function fetchCommunityResources() {
//   const items = await CommunityResource.find({ isActive: true })
//     .sort({ sortOrder: 1, createdAt: 1 })
//     .lean();

//   return {
//     status: items.length ? 'live' : 'unavailable',
//     items,
//   };
// }