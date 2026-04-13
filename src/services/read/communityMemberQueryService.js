import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import { fetchOrbitLevelSnapshot } from './orbitQueryService.js';

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

// async function readTokenBalancesWithFallback(contracts, normalizedAddress) {
//   let fgtBalances = [0n, 0n, 0n];
//   let fgtrBalances = [0n, 0n, 0n];

//   if (contracts?.tokenController?.getFGTBalances) {
//     try {
//       const result = await contracts.tokenController.getFGTBalances(normalizedAddress);
//       fgtBalances = [
//         BigInt(result?.[0] ?? 0),
//         BigInt(result?.[1] ?? 0),
//         BigInt(result?.[2] ?? 0),
//       ];
//     } catch (error) {
//       console.error('FGT tokenController balance read failed:', error);
//     }
//   } else if (contracts?.fgtToken?.balanceOf) {
//     try {
//       const total = BigInt(await contracts.fgtToken.balanceOf(normalizedAddress));
//       let locked = 0n;

//       if (contracts.fgtToken.lockedBalanceOf) {
//         locked = BigInt(await contracts.fgtToken.lockedBalanceOf(normalizedAddress));
//       } else if (contracts.fgtToken.lockedBalances) {
//         locked = BigInt(await contracts.fgtToken.lockedBalances(normalizedAddress));
//       }

//       const available = total >= locked ? total - locked : 0n;
//       fgtBalances = [total, locked, available];
//     } catch (error) {
//       console.error('FGT direct token balance read failed:', error);
//     }
//   }

//   if (contracts?.tokenController?.getFGTrBalances) {
//     try {
//       const result = await contracts.tokenController.getFGTrBalances(normalizedAddress);
//       fgtrBalances = [
//         BigInt(result?.[0] ?? 0),
//         BigInt(result?.[1] ?? 0),
//         BigInt(result?.[2] ?? 0),
//       ];
//     } catch (error) {
//       console.error('FGTr tokenController balance read failed:', error);
//     }
//   } else if (contracts?.fgtrToken?.balanceOf) {
//     try {
//       const total = BigInt(await contracts.fgtrToken.balanceOf(normalizedAddress));
//       let locked = 0n;

//       if (contracts.fgtrToken.lockedBalanceOf) {
//         locked = BigInt(await contracts.fgtrToken.lockedBalanceOf(normalizedAddress));
//       } else if (contracts.fgtrToken.lockedBalances) {
//         locked = BigInt(await contracts.fgtrToken.lockedBalances(normalizedAddress));
//       }

//       const available = total >= locked ? total - locked : 0n;
//       fgtrBalances = [total, locked, available];
//     } catch (error) {
//       console.error('FGTr direct token balance read failed:', error);
//     }
//   }

//   return { fgtBalances, fgtrBalances };
// }


async function readTokenBalancesWithFallback(contracts, normalizedAddress) {
  let fgtBalances = [0n, 0n, 0n];
  let fgtrBalances = [0n, 0n, 0n];

  console.log('[TOKEN DEBUG] address:', normalizedAddress);
  console.log('[TOKEN DEBUG] contract keys:', Object.keys(contracts || {}));

  // CORRECTION: Use freedomTokenController instead of tokenController
  const tokenController = contracts?.freedomTokenController;

  if (tokenController) {
    console.log('[TOKEN DEBUG] freedomTokenController found');
    console.log(
      '[TOKEN DEBUG] freedomTokenController methods:',
      typeof tokenController.getFGTBalances,
      typeof tokenController.getFGTrBalances
    );
  } else {
    console.log('[TOKEN DEBUG] freedomTokenController missing');
  }

  // Try freedomTokenController first for FGT
  if (tokenController?.getFGTBalances) {
    try {
      const result = await tokenController.getFGTBalances(normalizedAddress);
      console.log('[TOKEN DEBUG] freedomTokenController.getFGTBalances result:', result);
      fgtBalances = [
        BigInt(result?.[0] ?? 0),
        BigInt(result?.[1] ?? 0),
        BigInt(result?.[2] ?? 0),
      ];
    } catch (error) {
      console.error('FGT tokenController balance read failed:', error);
    }
  }

  // Fallback to direct fgtToken if controller fails or returns zero
  if (fgtBalances[0] === 0n && contracts?.fgtToken?.balanceOf) {
    try {
      const total = BigInt(await contracts.fgtToken.balanceOf(normalizedAddress));
      console.log('[TOKEN DEBUG] fgtToken.balanceOf total:', total.toString());

      let locked = 0n;

      if (contracts.fgtToken.lockedBalanceOf) {
        locked = BigInt(await contracts.fgtToken.lockedBalanceOf(normalizedAddress));
        console.log('[TOKEN DEBUG] fgtToken.lockedBalanceOf:', locked.toString());
      } else if (contracts.fgtToken.lockedBalances) {
        locked = BigInt(await contracts.fgtToken.lockedBalances(normalizedAddress));
        console.log('[TOKEN DEBUG] fgtToken.lockedBalances:', locked.toString());
      }

      const available = total >= locked ? total - locked : 0n;
      fgtBalances = [total, locked, available];
    } catch (error) {
      console.error('FGT direct token balance read failed:', error);
    }
  }

  // Try freedomTokenController first for FGTR
  if (tokenController?.getFGTrBalances) {
    try {
      const result = await tokenController.getFGTrBalances(normalizedAddress);
      console.log('[TOKEN DEBUG] freedomTokenController.getFGTrBalances result:', result);
      fgtrBalances = [
        BigInt(result?.[0] ?? 0),
        BigInt(result?.[1] ?? 0),
        BigInt(result?.[2] ?? 0),
      ];
    } catch (error) {
      console.error('FGTr tokenController balance read failed:', error);
    }
  }

  // Fallback to direct fgtrToken if controller fails or returns zero
  if (fgtrBalances[0] === 0n && contracts?.fgtrToken?.balanceOf) {
    try {
      const total = BigInt(await contracts.fgtrToken.balanceOf(normalizedAddress));
      console.log('[TOKEN DEBUG] fgtrToken.balanceOf total:', total.toString());

      let locked = 0n;

      if (contracts.fgtrToken.lockedBalanceOf) {
        locked = BigInt(await contracts.fgtrToken.lockedBalanceOf(normalizedAddress));
        console.log('[TOKEN DEBUG] fgtrToken.lockedBalanceOf:', locked.toString());
      } else if (contracts.fgtrToken.lockedBalances) {
        locked = BigInt(await contracts.fgtrToken.lockedBalances(normalizedAddress));
        console.log('[TOKEN DEBUG] fgtrToken.lockedBalances:', locked.toString());
      }

      const available = total >= locked ? total - locked : 0n;
      fgtrBalances = [total, locked, available];
    } catch (error) {
      console.error('FGTr direct token balance read failed:', error);
    }
  }

  console.log('[TOKEN DEBUG] final fgtBalances:', fgtBalances.map(String));
  console.log('[TOKEN DEBUG] final fgtrBalances:', fgtrBalances.map(String));

  return { fgtBalances, fgtrBalances };
}


export async function fetchCommunityMemberSummary(address) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedLower = lower(normalizedAddress);
  const contracts = getContracts();

  const [
    isRegisteredRaw,
    highestActiveLevelRaw,
    referrerRaw,
    receiptRows,
    tokenBalances,
  ] = await Promise.all([
    contracts.registration.isRegistered(normalizedAddress).catch(() => false),
    contracts.registration.highestActiveLevel(normalizedAddress).catch(() => 0),
    contracts.registration.getReferrer(normalizedAddress).catch(() => ethers.ZeroAddress),
    IndexedReceipt.find({ receiver: normalizedLower })
      .select('liquidPaid escrowLocked grossAmount')
      .lean(),
    readTokenBalancesWithFallback(contracts, normalizedAddress),
  ]);

  let activeLevelsCount = 0;
  try {
    const levelStates = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        contracts.registration.isLevelActivated(normalizedAddress, index + 1).catch(() => false)
      )
    );
    activeLevelsCount = levelStates.filter(Boolean).length;
  } catch {
    activeLevelsCount = 0;
  }

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
}

export async function fetchCommunityMemberReferralStats(address) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedLower = lower(normalizedAddress);

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
      .select('grossAmount liquidPaid escrowLocked fromUser orbitOwner sourcePosition sourceCycle activationId')
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
}