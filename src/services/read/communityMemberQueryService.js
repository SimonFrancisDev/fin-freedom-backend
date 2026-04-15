import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js'

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

function normalizeAddress(address) {
  if (!ethers.isAddress(address)) {
    const error = new Error('Invalid wallet address');
    error.status = 400;
    throw error;
  }

  return ethers.getAddress(address);
}

function lower(address) {
  return address.toLowerCase();
}

function formatTokenAmount(value) {
  try {
    return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
  } catch {
    return '0.00';
  }
}

function formatRawUsdt(value) {
  try {
    return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
  } catch {
    return '0.00';
  }
}

function sumRawReceiptField(rows, fieldName) {
  return rows.reduce((acc, row) => {
    try {
      return acc + BigInt(row?.[fieldName] || '0');
    } catch {
      return acc;
    }
  }, 0n);
}

async function tryRpc(fn, fallback) {
  try {
    return await safeRpcCall(fn);
  } catch {
    return fallback;
  }
}

async function resolveHighestActiveLevel(registration, normalizedAddress) {
  if (typeof registration?.highestActiveLevel === 'function') {
    const direct = await tryRpc(
      () => registration.highestActiveLevel(normalizedAddress),
      null
    );

    if (direct !== null && direct !== undefined) {
      return Number(direct || 0);
    }
  }

  const levelStates = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      tryRpc(() => registration.isLevelActivated(normalizedAddress, index + 1), false)
    )
  );

  let highest = 0;
  for (let index = 0; index < levelStates.length; index += 1) {
    if (levelStates[index]) highest = index + 1;
  }

  return highest;
}

async function readLockedBalance(tokenContract, normalizedAddress) {
  if (!tokenContract) return 0n;

  if (typeof tokenContract.lockedBalanceOf === 'function') {
    return tryRpc(() => tokenContract.lockedBalanceOf(normalizedAddress), 0n);
  }

  if (typeof tokenContract.lockedBalances === 'function') {
    return tryRpc(() => tokenContract.lockedBalances(normalizedAddress), 0n);
  }

  return 0n;
}

async function readTokenBalancesWithFallback(contracts, normalizedAddress) {
  let fgtBalances = [0n, 0n, 0n];
  let fgtrBalances = [0n, 0n, 0n];

  const tokenController = contracts?.freedomTokenController;

  if (tokenController?.getFGTBalances) {
    const result = await tryRpc(() => tokenController.getFGTBalances(normalizedAddress), null);
    if (result) {
      fgtBalances = [
        BigInt(result?.[0] ?? 0),
        BigInt(result?.[1] ?? 0),
        BigInt(result?.[2] ?? 0),
      ];
    }
  }

  if (fgtBalances[0] === 0n && contracts?.fgtToken?.balanceOf) {
    const total = await tryRpc(() => contracts.fgtToken.balanceOf(normalizedAddress), 0n);
    const locked = await readLockedBalance(contracts.fgtToken, normalizedAddress);
    const available = total >= locked ? total - locked : 0n;
    fgtBalances = [BigInt(total || 0), BigInt(locked || 0), BigInt(available || 0)];
  }

  if (tokenController?.getFGTrBalances) {
    const result = await tryRpc(() => tokenController.getFGTrBalances(normalizedAddress), null);
    if (result) {
      fgtrBalances = [
        BigInt(result?.[0] ?? 0),
        BigInt(result?.[1] ?? 0),
        BigInt(result?.[2] ?? 0),
      ];
    }
  }

  if (fgtrBalances[0] === 0n && contracts?.fgtrToken?.balanceOf) {
    const total = await tryRpc(() => contracts.fgtrToken.balanceOf(normalizedAddress), 0n);
    const locked = await readLockedBalance(contracts.fgtrToken, normalizedAddress);
    const available = total >= locked ? total - locked : 0n;
    fgtrBalances = [BigInt(total || 0), BigInt(locked || 0), BigInt(available || 0)];
  }

  return { fgtBalances, fgtrBalances };
}

export async function fetchCommunityMemberSummary(address) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedLower = lower(normalizedAddress);
  const cacheKey = `community-member:summary:${normalizedLower}`;

  return cached(cacheKey, async () => {
    const contracts = getContracts();
    const registration = contracts.registration;

    const [receiptRows, tokenBalances, isRegisteredRaw, referrerRaw, highestActiveLevelRaw] =
      await Promise.all([
        IndexedReceipt.find({ receiver: normalizedLower })
          .select('liquidPaid escrowLocked grossAmount')
          .lean(),
        readTokenBalancesWithFallback(contracts, normalizedAddress),
        tryRpc(() => registration.isRegistered(normalizedAddress), false),
        tryRpc(() => registration.getReferrer(normalizedAddress), ethers.ZeroAddress),
        resolveHighestActiveLevel(registration, normalizedAddress),
      ]);

    const activeLevelsCount = Number(highestActiveLevelRaw || 0);

    const totalLiquidPaidRaw = sumRawReceiptField(receiptRows, 'liquidPaid');
    const totalEscrowLockedRaw = sumRawReceiptField(receiptRows, 'escrowLocked');
    const totalGrossAmountRaw = sumRawReceiptField(receiptRows, 'grossAmount');

    const cleanReferrer =
      referrerRaw && referrerRaw !== ethers.ZeroAddress ? referrerRaw : '';

    return {
      address: normalizedAddress,
      isRegistered: Boolean(isRegisteredRaw),
      referrer: cleanReferrer,
      highestActiveLevel: Number(highestActiveLevelRaw || 0),
      activeLevelsCount,
      totalReceiptEarnings: formatRawUsdt(totalLiquidPaidRaw),
      totalReceiptEscrowLocked: formatRawUsdt(totalEscrowLockedRaw),
      totalReceiptGross: formatRawUsdt(totalGrossAmountRaw),
      totalReceiptCount: receiptRows.length,
      fgtTotal: formatTokenAmount(tokenBalances.fgtBalances?.[0] || 0),
      fgtLocked: formatTokenAmount(tokenBalances.fgtBalances?.[1] || 0),
      fgtAvailable: formatTokenAmount(tokenBalances.fgtBalances?.[2] || 0),
      fgtrTotal: formatTokenAmount(tokenBalances.fgtrBalances?.[0] || 0),
      fgtrLocked: formatTokenAmount(tokenBalances.fgtrBalances?.[1] || 0),
      fgtrAvailable: formatTokenAmount(tokenBalances.fgtrBalances?.[2] || 0),
    };
  });
}

export async function fetchCommunityMemberReferralStats(address) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedLower = lower(normalizedAddress);
  const cacheKey = `community-member:referrals:${normalizedLower}`;

  return cached(cacheKey, async () => {
    const [directReferrals, referralReceipts] = await Promise.all([
      IndexedRegistrationEvent.find({
        eventName: 'Registered',
        referrer: normalizedLower,
      })
        .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
        .select('user referrer timestamp txHash blockNumber')
        .lean(),
      IndexedReceipt.find({
        receiver: normalizedLower,
        receiptType: 2,
      })
        .select(
          'grossAmount liquidPaid escrowLocked fromUser orbitOwner sourcePosition sourceCycle activationId'
        )
        .lean(),
    ]);

    const totalGrossRaw = sumRawReceiptField(referralReceipts, 'grossAmount');
    const totalLiquidRaw = sumRawReceiptField(referralReceipts, 'liquidPaid');
    const totalEscrowRaw = sumRawReceiptField(referralReceipts, 'escrowLocked');

    return {
      address: normalizedAddress,
      totalReferrals: directReferrals.length,
      commissionEarnedLiquid: formatRawUsdt(totalLiquidRaw),
      commissionEarnedGross: formatRawUsdt(totalGrossRaw),
      commissionEscrowLocked: formatRawUsdt(totalEscrowRaw),
      referralReceiptCount: referralReceipts.length,
      directReferrals: directReferrals.map((item) => ({
        user: item.user,
        timestamp: item.timestamp,
        txHash: item.txHash,
        blockNumber: item.blockNumber,
      })),
    };
  });
}

async function buildReferralGraphMap() {
  const rows = await IndexedRegistrationEvent.find({
    eventName: 'Registered',
  })
    .select('user referrer')
    .lean();

  const map = new Map();

  for (const row of rows) {
    const referrer = lower(row.referrer || '');
    const user = lower(row.user || '');
    if (!referrer || !user) continue;

    if (!map.has(referrer)) {
      map.set(referrer, []);
    }

    map.get(referrer).push(user);
  }

  return map;
}

export async function fetchCommunityMemberDownlineStats(address) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedLower = lower(normalizedAddress);
  const cacheKey = `community-member:downline:${normalizedLower}`;

  return cached(cacheKey, async () => {
    const graph = await buildReferralGraphMap();

    const counts = {};
    let currentLevel = [normalizedLower];
    const visited = new Set([normalizedLower]);

    for (let depth = 1; depth <= 10; depth += 1) {
      const nextLevel = [];

      for (const node of currentLevel) {
        const children = graph.get(node) || [];
        for (const child of children) {
          if (visited.has(child)) continue;
          visited.add(child);
          nextLevel.push(child);
        }
      }

      counts[`level${depth}`] = nextLevel.length;
      currentLevel = nextLevel;

      if (currentLevel.length === 0) {
        for (let remaining = depth + 1; remaining <= 10; remaining += 1) {
          counts[`level${remaining}`] = 0;
        }
        break;
      }
    }

    const total = Array.from({ length: 10 }, (_, index) => counts[`level${index + 1}`] || 0)
      .reduce((sum, value) => sum + value, 0);

    return {
      address: normalizedAddress,
      level1: counts.level1 || 0,
      level2: counts.level2 || 0,
      level3: counts.level3 || 0,
      level4: counts.level4 || 0,
      level5: counts.level5 || 0,
      level6: counts.level6 || 0,
      level7: counts.level7 || 0,
      level8: counts.level8 || 0,
      level9: counts.level9 || 0,
      level10: counts.level10 || 0,
      total,
    };
  });
}



export async function fetchCommunityMemberOrbitNetwork(address) {
  const normalizedAddress = normalizeAddress(address)
  const normalizedLower = lower(normalizedAddress)
  const cacheKey = `community-member:orbit-network:${normalizedLower}`

  return cached(cacheKey, async () => {
    const rows = await IndexedOrbitEvent.find({
      orbitOwner: normalizedLower,
      eventName: 'PositionFilled',
    })
      .select('orbitType level cycleNumber user position timestamp')
      .sort({ level: 1, cycleNumber: 1, position: 1, timestamp: 1 })
      .lean()

    const levels = {}

    for (const row of rows) {
      const level = Number(row.level || 0)
      const cycleNumber = Number(row.cycleNumber || 1)
      const user = lower(row.user || '')

      if (!level || !user) continue

      const levelKey = `level${level}`

      if (!levels[levelKey]) {
        levels[levelKey] = {
          cycles: {},
          totalMembersAcrossCycles: 0,
        }
      }

      if (!levels[levelKey].cycles[cycleNumber]) {
        levels[levelKey].cycles[cycleNumber] = {
          cycle: cycleNumber,
          members: new Set(),
        }
      }

      // Count user once per cycle
      levels[levelKey].cycles[cycleNumber].members.add(user)
    }

    const formattedLevels = {}

    for (const [levelKey, levelData] of Object.entries(levels)) {
      const cycleList = Object.values(levelData.cycles)
        .map((cycleEntry) => ({
          cycle: cycleEntry.cycle,
          members: cycleEntry.members.size,
          memberAddresses: Array.from(cycleEntry.members),
        }))
        .sort((a, b) => a.cycle - b.cycle)

      formattedLevels[levelKey] = {
        cycles: cycleList,
        totalMembersAcrossCycles: cycleList.reduce((sum, item) => sum + item.members, 0),
        latestCycle: cycleList.length ? cycleList[cycleList.length - 1].cycle : 0,
        latestCycleMembers: cycleList.length ? cycleList[cycleList.length - 1].members : 0,
      }
    }

    return {
      address: normalizedAddress,
      networkType: 'orbit-cycle-members',
      levels: formattedLevels,
    }
  })
}
















// import { ethers } from 'ethers';
// import { getContracts } from '../../blockchain/contracts.js';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
// import { fetchOrbitLevelSnapshot } from './orbitQueryService.js';

// function normalizeAddress(address) {
//   if (!ethers.isAddress(address)) {
//     const error = new Error('Invalid wallet address');
//     error.status = 400;
//     throw error;
//   }

//   return ethers.getAddress(address);
// }

// function lower(address) {
//   return address.toLowerCase();
// }

// function formatTokenAmount(value) {
//   try {
//     return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
//   } catch {
//     return '0.00';
//   }
// }

// function formatRawUsdt(value) {
//   try {
//     return Number(ethers.formatUnits(value ?? 0, 6)).toFixed(2);
//   } catch {
//     return '0.00';
//   }
// }

// function sumRawReceiptField(rows, fieldName) {
//   return rows.reduce((acc, row) => {
//     try {
//       return acc + BigInt(row?.[fieldName] || '0');
//     } catch {
//       return acc;
//     }
//   }, 0n);
// }

// // async function readTokenBalancesWithFallback(contracts, normalizedAddress) {
// //   let fgtBalances = [0n, 0n, 0n];
// //   let fgtrBalances = [0n, 0n, 0n];

// //   if (contracts?.tokenController?.getFGTBalances) {
// //     try {
// //       const result = await contracts.tokenController.getFGTBalances(normalizedAddress);
// //       fgtBalances = [
// //         BigInt(result?.[0] ?? 0),
// //         BigInt(result?.[1] ?? 0),
// //         BigInt(result?.[2] ?? 0),
// //       ];
// //     } catch (error) {
// //       console.error('FGT tokenController balance read failed:', error);
// //     }
// //   } else if (contracts?.fgtToken?.balanceOf) {
// //     try {
// //       const total = BigInt(await contracts.fgtToken.balanceOf(normalizedAddress));
// //       let locked = 0n;

// //       if (contracts.fgtToken.lockedBalanceOf) {
// //         locked = BigInt(await contracts.fgtToken.lockedBalanceOf(normalizedAddress));
// //       } else if (contracts.fgtToken.lockedBalances) {
// //         locked = BigInt(await contracts.fgtToken.lockedBalances(normalizedAddress));
// //       }

// //       const available = total >= locked ? total - locked : 0n;
// //       fgtBalances = [total, locked, available];
// //     } catch (error) {
// //       console.error('FGT direct token balance read failed:', error);
// //     }
// //   }

// //   if (contracts?.tokenController?.getFGTrBalances) {
// //     try {
// //       const result = await contracts.tokenController.getFGTrBalances(normalizedAddress);
// //       fgtrBalances = [
// //         BigInt(result?.[0] ?? 0),
// //         BigInt(result?.[1] ?? 0),
// //         BigInt(result?.[2] ?? 0),
// //       ];
// //     } catch (error) {
// //       console.error('FGTr tokenController balance read failed:', error);
// //     }
// //   } else if (contracts?.fgtrToken?.balanceOf) {
// //     try {
// //       const total = BigInt(await contracts.fgtrToken.balanceOf(normalizedAddress));
// //       let locked = 0n;

// //       if (contracts.fgtrToken.lockedBalanceOf) {
// //         locked = BigInt(await contracts.fgtrToken.lockedBalanceOf(normalizedAddress));
// //       } else if (contracts.fgtrToken.lockedBalances) {
// //         locked = BigInt(await contracts.fgtrToken.lockedBalances(normalizedAddress));
// //       }

// //       const available = total >= locked ? total - locked : 0n;
// //       fgtrBalances = [total, locked, available];
// //     } catch (error) {
// //       console.error('FGTr direct token balance read failed:', error);
// //     }
// //   }

// //   return { fgtBalances, fgtrBalances };
// // }


// async function readTokenBalancesWithFallback(contracts, normalizedAddress) {
//   let fgtBalances = [0n, 0n, 0n];
//   let fgtrBalances = [0n, 0n, 0n];

//   console.log('[TOKEN DEBUG] address:', normalizedAddress);
//   console.log('[TOKEN DEBUG] contract keys:', Object.keys(contracts || {}));

//   // CORRECTION: Use freedomTokenController instead of tokenController
//   const tokenController = contracts?.freedomTokenController;

//   if (tokenController) {
//     console.log('[TOKEN DEBUG] freedomTokenController found');
//     console.log(
//       '[TOKEN DEBUG] freedomTokenController methods:',
//       typeof tokenController.getFGTBalances,
//       typeof tokenController.getFGTrBalances
//     );
//   } else {
//     console.log('[TOKEN DEBUG] freedomTokenController missing');
//   }

//   // Try freedomTokenController first for FGT
//   if (tokenController?.getFGTBalances) {
//     try {
//       const result = await tokenController.getFGTBalances(normalizedAddress);
//       console.log('[TOKEN DEBUG] freedomTokenController.getFGTBalances result:', result);
//       fgtBalances = [
//         BigInt(result?.[0] ?? 0),
//         BigInt(result?.[1] ?? 0),
//         BigInt(result?.[2] ?? 0),
//       ];
//     } catch (error) {
//       console.error('FGT tokenController balance read failed:', error);
//     }
//   }

//   // Fallback to direct fgtToken if controller fails or returns zero
//   if (fgtBalances[0] === 0n && contracts?.fgtToken?.balanceOf) {
//     try {
//       const total = BigInt(await contracts.fgtToken.balanceOf(normalizedAddress));
//       console.log('[TOKEN DEBUG] fgtToken.balanceOf total:', total.toString());

//       let locked = 0n;

//       if (contracts.fgtToken.lockedBalanceOf) {
//         locked = BigInt(await contracts.fgtToken.lockedBalanceOf(normalizedAddress));
//         console.log('[TOKEN DEBUG] fgtToken.lockedBalanceOf:', locked.toString());
//       } else if (contracts.fgtToken.lockedBalances) {
//         locked = BigInt(await contracts.fgtToken.lockedBalances(normalizedAddress));
//         console.log('[TOKEN DEBUG] fgtToken.lockedBalances:', locked.toString());
//       }

//       const available = total >= locked ? total - locked : 0n;
//       fgtBalances = [total, locked, available];
//     } catch (error) {
//       console.error('FGT direct token balance read failed:', error);
//     }
//   }

//   // Try freedomTokenController first for FGTR
//   if (tokenController?.getFGTrBalances) {
//     try {
//       const result = await tokenController.getFGTrBalances(normalizedAddress);
//       console.log('[TOKEN DEBUG] freedomTokenController.getFGTrBalances result:', result);
//       fgtrBalances = [
//         BigInt(result?.[0] ?? 0),
//         BigInt(result?.[1] ?? 0),
//         BigInt(result?.[2] ?? 0),
//       ];
//     } catch (error) {
//       console.error('FGTr tokenController balance read failed:', error);
//     }
//   }

//   // Fallback to direct fgtrToken if controller fails or returns zero
//   if (fgtrBalances[0] === 0n && contracts?.fgtrToken?.balanceOf) {
//     try {
//       const total = BigInt(await contracts.fgtrToken.balanceOf(normalizedAddress));
//       console.log('[TOKEN DEBUG] fgtrToken.balanceOf total:', total.toString());

//       let locked = 0n;

//       if (contracts.fgtrToken.lockedBalanceOf) {
//         locked = BigInt(await contracts.fgtrToken.lockedBalanceOf(normalizedAddress));
//         console.log('[TOKEN DEBUG] fgtrToken.lockedBalanceOf:', locked.toString());
//       } else if (contracts.fgtrToken.lockedBalances) {
//         locked = BigInt(await contracts.fgtrToken.lockedBalances(normalizedAddress));
//         console.log('[TOKEN DEBUG] fgtrToken.lockedBalances:', locked.toString());
//       }

//       const available = total >= locked ? total - locked : 0n;
//       fgtrBalances = [total, locked, available];
//     } catch (error) {
//       console.error('FGTr direct token balance read failed:', error);
//     }
//   }

//   console.log('[TOKEN DEBUG] final fgtBalances:', fgtBalances.map(String));
//   console.log('[TOKEN DEBUG] final fgtrBalances:', fgtrBalances.map(String));

//   return { fgtBalances, fgtrBalances };
// }


// export async function fetchCommunityMemberSummary(address) {
//   const normalizedAddress = normalizeAddress(address);
//   const normalizedLower = lower(normalizedAddress);
//   const contracts = getContracts();

//   const [
//     isRegisteredRaw,
//     highestActiveLevelRaw,
//     referrerRaw,
//     receiptRows,
//     tokenBalances,
//   ] = await Promise.all([
//     contracts.registration.isRegistered(normalizedAddress).catch(() => false),
//     contracts.registration.highestActiveLevel(normalizedAddress).catch(() => 0),
//     contracts.registration.getReferrer(normalizedAddress).catch(() => ethers.ZeroAddress),
//     IndexedReceipt.find({ receiver: normalizedLower })
//       .select('liquidPaid escrowLocked grossAmount')
//       .lean(),
//     readTokenBalancesWithFallback(contracts, normalizedAddress),
//   ]);

//   let activeLevelsCount = 0;
//   try {
//     const levelStates = await Promise.all(
//       Array.from({ length: 10 }, (_, index) =>
//         contracts.registration.isLevelActivated(normalizedAddress, index + 1).catch(() => false)
//       )
//     );
//     activeLevelsCount = levelStates.filter(Boolean).length;
//   } catch {
//     activeLevelsCount = 0;
//   }

//   const totalLiquidPaidRaw = sumRawReceiptField(receiptRows, 'liquidPaid');
//   const totalEscrowLockedRaw = sumRawReceiptField(receiptRows, 'escrowLocked');
//   const totalGrossAmountRaw = sumRawReceiptField(receiptRows, 'grossAmount');

//   const cleanReferrer =
//     referrerRaw && referrerRaw !== ethers.ZeroAddress ? referrerRaw : '';

//   return {
//     address: normalizedAddress,
//     isRegistered: Boolean(isRegisteredRaw),
//     referrer: cleanReferrer,
//     highestActiveLevel: Number(highestActiveLevelRaw || 0),
//     activeLevelsCount,
//     totalReceiptEarnings: formatRawUsdt(totalLiquidPaidRaw),
//     totalReceiptEscrowLocked: formatRawUsdt(totalEscrowLockedRaw),
//     totalReceiptGross: formatRawUsdt(totalGrossAmountRaw),
//     totalReceiptCount: receiptRows.length,
//     fgtTotal: formatTokenAmount(tokenBalances.fgtBalances?.[0] || 0),
//     fgtLocked: formatTokenAmount(tokenBalances.fgtBalances?.[1] || 0),
//     fgtAvailable: formatTokenAmount(tokenBalances.fgtBalances?.[2] || 0),
//     fgtrTotal: formatTokenAmount(tokenBalances.fgtrBalances?.[0] || 0),
//     fgtrLocked: formatTokenAmount(tokenBalances.fgtrBalances?.[1] || 0),
//     fgtrAvailable: formatTokenAmount(tokenBalances.fgtrBalances?.[2] || 0),
//   };
// }

// export async function fetchCommunityMemberReferralStats(address) {
//   const normalizedAddress = normalizeAddress(address);
//   const normalizedLower = lower(normalizedAddress);

//   const [directReferrals, referralReceipts] = await Promise.all([
//     IndexedRegistrationEvent.find({
//       eventName: 'Registered',
//       referrer: normalizedLower,
//     })
//       .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
//       .select('user referrer timestamp txHash blockNumber')
//       .lean(),
//     IndexedReceipt.find({
//       receiver: normalizedLower,
//       receiptType: 2,
//     })
//       .select('grossAmount liquidPaid escrowLocked fromUser orbitOwner sourcePosition sourceCycle activationId')
//       .lean(),
//   ]);

//   const totalGrossRaw = sumRawReceiptField(referralReceipts, 'grossAmount');
//   const totalLiquidRaw = sumRawReceiptField(referralReceipts, 'liquidPaid');
//   const totalEscrowRaw = sumRawReceiptField(referralReceipts, 'escrowLocked');

//   return {
//     address: normalizedAddress,
//     totalReferrals: directReferrals.length,
//     commissionEarnedLiquid: formatRawUsdt(totalLiquidRaw),
//     commissionEarnedGross: formatRawUsdt(totalGrossRaw),
//     commissionEscrowLocked: formatRawUsdt(totalEscrowRaw),
//     referralReceiptCount: referralReceipts.length,
//     directReferrals: directReferrals.map((item) => ({
//       user: item.user,
//       timestamp: item.timestamp,
//       txHash: item.txHash,
//       blockNumber: item.blockNumber,
//     })),
//   };
// }

// async function buildReferralGraphMap() {
//   const rows = await IndexedRegistrationEvent.find({
//     eventName: 'Registered',
//   })
//     .select('user referrer')
//     .lean();

//   const map = new Map();

//   for (const row of rows) {
//     const referrer = lower(row.referrer || '');
//     const user = lower(row.user || '');
//     if (!referrer || !user) continue;

//     if (!map.has(referrer)) {
//       map.set(referrer, []);
//     }

//     map.get(referrer).push(user);
//   }

//   return map;
// }

// export async function fetchCommunityMemberDownlineStats(address) {
//   const normalizedAddress = normalizeAddress(address);
//   const normalizedLower = lower(normalizedAddress);

//   const graph = await buildReferralGraphMap();

//   const counts = {};
//   let currentLevel = [normalizedLower];
//   const visited = new Set([normalizedLower]);

//   for (let depth = 1; depth <= 10; depth += 1) {
//     const nextLevel = [];

//     for (const node of currentLevel) {
//       const children = graph.get(node) || [];
//       for (const child of children) {
//         if (visited.has(child)) continue;
//         visited.add(child);
//         nextLevel.push(child);
//       }
//     }

//     counts[`level${depth}`] = nextLevel.length;
//     currentLevel = nextLevel;

//     if (currentLevel.length === 0) {
//       for (let remaining = depth + 1; remaining <= 10; remaining += 1) {
//         counts[`level${remaining}`] = 0;
//       }
//       break;
//     }
//   }

//   const total = Array.from({ length: 10 }, (_, index) => counts[`level${index + 1}`] || 0)
//     .reduce((sum, value) => sum + value, 0);

//   return {
//     address: normalizedAddress,
//     level1: counts.level1 || 0,
//     level2: counts.level2 || 0,
//     level3: counts.level3 || 0,
//     level4: counts.level4 || 0,
//     level5: counts.level5 || 0,
//     level6: counts.level6 || 0,
//     level7: counts.level7 || 0,
//     level8: counts.level8 || 0,
//     level9: counts.level9 || 0,
//     level10: counts.level10 || 0,
//     total,
//   };
// }