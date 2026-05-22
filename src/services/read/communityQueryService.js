import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
import CommunityEvent from '../../models/CommunityEvent.js';
import CommunitySocialLink from '../../models/CommunitySocialLink.js';
import CommunityResource from '../../models/CommunityResource.js';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import IndexedEscrowEvent from '../../models/IndexedEscrowEvent.js';
import IndexedActivationSummary from '../../models/IndexedActivationSummary.js';
import IndexedFinancialEvent from '../../models/IndexedFinancialEvent.js';

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


async function fetchTreasuryBreakdown(contracts) {
  const usdt = contracts?.usdt
  const levelManager = contracts?.levelManager

  if (!usdt || !levelManager) {
    return {
      nftPool: '0.00',
      operations: '0.00',
    }
  }

  try {
    const nftPoolAddress = await safeRpcCall(() =>
      levelManager.nftPool()
    )

    const opsAddress = await safeRpcCall(() =>
      levelManager.operationsWallet()
    )

    const [nftRaw, opsRaw] = await Promise.all([
      safeBalanceOf(usdt, nftPoolAddress),
      safeBalanceOf(usdt, opsAddress),
    ])

    return {
      nftPool: formatUsdt(nftRaw),
      operations: formatUsdt(opsRaw),
      nftPoolRaw: String(nftRaw || 0),
      operationsRaw: String(opsRaw || 0),
    }
  } catch {
    return {
      nftPool: '0.00',
      operations: '0.00',
      nftPoolRaw: '0',
      operationsRaw: '0',
    }
  }
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

function toBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return 0n;
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function addRawStrings(items, fieldName) {
  return items.reduce((acc, item) => acc + toBigIntSafe(item?.[fieldName]), 0n);
}

async function fetchGlobalReceiptMetrics() {
  try {
    const receipts = await IndexedReceipt.find({})
      .select('grossAmount escrowLocked liquidPaid receiptType')
      .lean();

    const totalGeneratedRaw = addRawStrings(receipts, 'grossAmount');
    const totalWalletCreditedRaw = addRawStrings(receipts, 'liquidPaid');
    const receiptEscrowLockedRaw = addRawStrings(receipts, 'escrowLocked');
    const recycleReceipts = receipts.filter(
      (receipt) => Number(receipt.receiptType || 0) === 4
    );
    const recyclePaidLiquidRaw = addRawStrings(recycleReceipts, 'liquidPaid');
    const recycleEscrowLockedRaw = addRawStrings(recycleReceipts, 'escrowLocked');

    return {
      totalGeneratedRaw,
      totalWalletCreditedRaw,
      receiptEscrowLockedRaw,
      recyclePaidLiquidRaw,
      recycleEscrowLockedRaw,
      receiptCount: receipts.length,
    };
  } catch {
    return {
      totalGeneratedRaw: 0n,
      totalWalletCreditedRaw: 0n,
      receiptEscrowLockedRaw: 0n,
      recyclePaidLiquidRaw: 0n,
      recycleEscrowLockedRaw: 0n,
      receiptCount: 0,
    };
  }
}

async function fetchGlobalEscrowMetrics(contracts) {
  let lockedLifetimeRaw = 0n;
  let usedForUpgradeRaw = 0n;
  let releasedToUsersRaw = 0n;
  let currentLockedRaw = 0n;

  try {
    const events = await IndexedEscrowEvent.find({})
      .select('eventName amount currentEscrowLockedGlobal blockNumber logIndex')
      .sort({ blockNumber: 1, logIndex: 1 })
      .lean();

    for (const event of events) {
      const amount = toBigIntSafe(event.amount);

      if (event.eventName === 'EscrowLocked') {
        lockedLifetimeRaw += amount;
      }

      if (event.eventName === 'EscrowUsedForUpgrade') {
        usedForUpgradeRaw += amount;
      }

      if (event.eventName === 'EscrowReleasedToUser') {
        releasedToUsersRaw += amount;
      }
    }

    const latestWithCurrent = [...events]
      .reverse()
      .find((event) => event.currentEscrowLockedGlobal !== undefined);

    if (latestWithCurrent) {
      currentLockedRaw = toBigIntSafe(latestWithCurrent.currentEscrowLockedGlobal);
    }
  } catch {
    lockedLifetimeRaw = 0n;
    usedForUpgradeRaw = 0n;
    releasedToUsersRaw = 0n;
    currentLockedRaw = 0n;
  }

  // Strongest live fallback: read directly from the escrow contract if ABI is updated.
  try {
    const escrow = contracts?.autoUpgradeEscrow || contracts?.escrow;

    if (escrow?.getGlobalEscrowStats) {
      const [lockedLifetime, usedForUpgrade, releasedToUsers, currentlyLocked] =
        await safeRpcCall(() => escrow.getGlobalEscrowStats());

      lockedLifetimeRaw = toBigIntSafe(lockedLifetime);
      usedForUpgradeRaw = toBigIntSafe(usedForUpgrade);
      releasedToUsersRaw = toBigIntSafe(releasedToUsers);
      currentLockedRaw = toBigIntSafe(currentlyLocked);
    }
  } catch {
    // Keep indexed fallback.
  }

  return {
    lockedLifetimeRaw,
    usedForUpgradeRaw,
    releasedToUsersRaw,
    currentLockedRaw,
  };
}

async function fetchGlobalActivationSummaryMetrics() {
  try {
    const [summaries, detailedSystemCharges] = await Promise.all([
      IndexedActivationSummary.find({})
      .select(
        'systemCharge nftPoolAmount operationsAmount totalEscrowLocked totalRecycleAllocated activationAmount isFounderRepFreeActivation'
      )
        .lean(),
      IndexedFinancialEvent.find({ eventName: 'SystemChargeDistributedDetailed' })
        .select('systemChargeTotal nftPoolAmount operationsAmount')
        .lean(),
    ]);

    const hasDetailedSystemCharges = detailedSystemCharges.length > 0;
    const nftPoolReceivedRaw = hasDetailedSystemCharges
      ? addRawStrings(detailedSystemCharges, 'nftPoolAmount')
      : addRawStrings(summaries, 'nftPoolAmount');
    const operationsReceivedRaw = hasDetailedSystemCharges
      ? addRawStrings(detailedSystemCharges, 'operationsAmount')
      : addRawStrings(summaries, 'operationsAmount');
    const systemChargeRaw = hasDetailedSystemCharges
      ? addRawStrings(detailedSystemCharges, 'systemChargeTotal')
      : addRawStrings(summaries, 'systemCharge');
    const activationVolumeRaw = addRawStrings(summaries, 'activationAmount');
    const activationEscrowRaw = addRawStrings(summaries, 'totalEscrowLocked');
    const recycleAllocatedRaw = addRawStrings(summaries, 'totalRecycleAllocated');

    const paidActivationCount = summaries.filter(
      (item) => !item.isFounderRepFreeActivation
    ).length;

    const founderRepFreeActivationCount = summaries.filter(
      (item) => item.isFounderRepFreeActivation
    ).length;

    return {
      nftPoolReceivedRaw,
      operationsReceivedRaw,
      systemChargeRaw,
      activationVolumeRaw,
      activationEscrowRaw,
      recycleAllocatedRaw,
      paidActivationCount,
      founderRepFreeActivationCount,
      activationSummaryCount: summaries.length,
      systemChargeTruthSource: hasDetailedSystemCharges
        ? 'indexed_system_charge_distributed_detailed'
        : 'indexed_activation_summaries',
    };
  } catch {
    return {
      nftPoolReceivedRaw: 0n,
      operationsReceivedRaw: 0n,
      systemChargeRaw: 0n,
      activationVolumeRaw: 0n,
      activationEscrowRaw: 0n,
      recycleAllocatedRaw: 0n,
      paidActivationCount: 0,
      founderRepFreeActivationCount: 0,
      activationSummaryCount: 0,
      systemChargeTruthSource: 'unavailable',
    };
  }
}

async function fetchVisibleCoreBalance(contracts, financialMetrics = null) {
  const indexedValueRaw = financialMetrics
    ? financialMetrics.totalProtocolDistributedValueRaw
    : 0n;

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

  return indexedValueRaw > onChainBalanceRaw
    ? indexedValueRaw
    : onChainBalanceRaw;
}

async function fetchCommunityFinancialMetrics(contracts) {
  const [receiptMetrics, escrowMetrics, activationMetrics] = await Promise.all([
    fetchGlobalReceiptMetrics(),
    fetchGlobalEscrowMetrics(contracts),
    fetchGlobalActivationSummaryMetrics(),
  ]);

  const escrowLockedLifetimeRaw =
    escrowMetrics.lockedLifetimeRaw > 0n
      ? escrowMetrics.lockedLifetimeRaw
      : receiptMetrics.receiptEscrowLockedRaw;

  const nftPoolReceivedRaw = activationMetrics.nftPoolReceivedRaw;
  const operationsReceivedRaw = activationMetrics.operationsReceivedRaw;

  const receiptLiquidPaidRaw = receiptMetrics.totalWalletCreditedRaw;
  const totalWalletCreditedRaw =
    receiptLiquidPaidRaw + escrowMetrics.releasedToUsersRaw;

  const totalProtocolDistributedValueRaw =
    totalWalletCreditedRaw +
    escrowLockedLifetimeRaw +
    nftPoolReceivedRaw +
    operationsReceivedRaw;

  return {
    ...receiptMetrics,
    ...escrowMetrics,
    ...activationMetrics,

    receiptLiquidPaidRaw,
    totalWalletCreditedRaw,
    escrowLockedLifetimeRaw,
    nftPoolReceivedRaw,
    operationsReceivedRaw,
    totalProtocolDistributedValueRaw,
  };
}

export async function fetchCommunitySummary() {
  return cached('community:summary', async () => {
    const contracts = getContracts();

    const [
      totalParticipants,
      treasury,
      financialMetrics,
      announcementCount,
      eventCount,
      socialCount,
      resourceCount,
      receiptCount,
    ] = await Promise.all([
      fetchTotalParticipants(contracts),
      fetchTreasuryBreakdown(contracts),
      fetchCommunityFinancialMetrics(contracts),
      CommunityAnnouncement.countDocuments({ isActive: true }).catch(() => 0),
      CommunityEvent.countDocuments({ isActive: true }).catch(() => 0),
      CommunitySocialLink.countDocuments({ isActive: true }).catch(() => 0),
      CommunityResource.countDocuments({ isActive: true }).catch(() => 0),
      IndexedReceipt.countDocuments().catch(() => 0),
    ]);

    const visibleCoreBalanceRaw = await fetchVisibleCoreBalance(contracts, financialMetrics);
    const nftPoolLiveRaw = toBigIntSafe(treasury?.nftPoolRaw || 0);
    const operationsLiveRaw = toBigIntSafe(treasury?.operationsRaw || 0);
    const nftPoolDistributedRaw =
      financialMetrics.nftPoolReceivedRaw > nftPoolLiveRaw
        ? financialMetrics.nftPoolReceivedRaw - nftPoolLiveRaw
        : 0n;
    const operationsUtilizedRaw =
      financialMetrics.operationsReceivedRaw > operationsLiveRaw
        ? financialMetrics.operationsReceivedRaw - operationsLiveRaw
        : 0n;

    return {
      public: {
        totalParticipants,

        // Backward-compatible existing field.
        visibleCoreBalanceUsdt: formatUsdt(visibleCoreBalanceRaw),

        // Live wallet balances.
        nftPool: treasury?.nftPool || '0.00',
        operations: treasury?.operations || '0.00',

        // New indexed/global financial truth.
        totalGeneratedVolume: formatUsdt(financialMetrics.totalGeneratedRaw),
        totalWalletCreditedPayouts: formatUsdt(financialMetrics.totalWalletCreditedRaw),
        totalEscrowLockedLifetime: formatUsdt(financialMetrics.escrowLockedLifetimeRaw),
        totalAutoUpgradeUsed: formatUsdt(financialMetrics.usedForUpgradeRaw),
        totalEscrowReleasedToUsers: formatUsdt(financialMetrics.releasedToUsersRaw),
        currentEscrowLocked: formatUsdt(financialMetrics.currentLockedRaw),

        nftPoolReceived: formatUsdt(financialMetrics.nftPoolReceivedRaw),
        operationsReceived: formatUsdt(financialMetrics.operationsReceivedRaw),
        totalProtocolDistributedValue: formatUsdt(financialMetrics.totalProtocolDistributedValueRaw),

        generatedGross: formatUsdt(financialMetrics.totalGeneratedRaw),
        receiptLiquidPaid: formatUsdt(financialMetrics.receiptLiquidPaidRaw),
        walletCreditedLiquid: formatUsdt(financialMetrics.totalWalletCreditedRaw),
        receiptEscrowLocked: formatUsdt(financialMetrics.receiptEscrowLockedRaw),
        escrowLockedLifetime: formatUsdt(financialMetrics.escrowLockedLifetimeRaw),
        autoUpgradeUsed: formatUsdt(financialMetrics.usedForUpgradeRaw),
        escrowReleasedToUser: formatUsdt(financialMetrics.releasedToUsersRaw),
        systemChargeTotal: formatUsdt(financialMetrics.systemChargeRaw),
        nftPoolAllocated: formatUsdt(financialMetrics.nftPoolReceivedRaw),
        operationsAllocated: formatUsdt(financialMetrics.operationsReceivedRaw),
        nftPoolDistributed: formatUsdt(nftPoolDistributedRaw),
        operationsUtilized: formatUsdt(operationsUtilizedRaw),
        nftPoolLiveBalance: treasury?.nftPool || '0.00',
        operationsLiveBalance: treasury?.operations || '0.00',
        nftRewardPool: {
          totalInflow: formatUsdt(financialMetrics.nftPoolReceivedRaw),
          totalDistributed: formatUsdt(nftPoolDistributedRaw),
          currentBalance: treasury?.nftPool || '0.00',
        },
        devOperations: {
          totalInflow: formatUsdt(financialMetrics.operationsReceivedRaw),
          totalUtilized: formatUsdt(operationsUtilizedRaw),
          currentBalance: treasury?.operations || '0.00',
        },
        recycleAllocated: formatUsdt(financialMetrics.recycleAllocatedRaw),
        recyclePaidLiquid: formatUsdt(financialMetrics.recyclePaidLiquidRaw),
        recycleEscrowLocked: formatUsdt(financialMetrics.recycleEscrowLockedRaw),
        financialTruthSource: {
          generatedGross: 'indexed_receipts',
          receiptLiquidPaid: 'indexed_receipts',
          walletCreditedLiquid: 'indexed_receipts_plus_escrow_releases',
          receiptEscrowLocked: 'indexed_receipts',
          escrowLockedLifetime: financialMetrics.lockedLifetimeRaw > 0n
            ? 'indexed_or_live_escrow'
            : 'indexed_receipts_fallback',
          currentEscrowLocked: 'indexed_or_live_escrow',
          autoUpgradeUsed: 'indexed_or_live_escrow',
          escrowReleasedToUser: 'indexed_or_live_escrow',
          systemChargeTotal: financialMetrics.systemChargeTruthSource,
          nftPoolAllocated: financialMetrics.systemChargeTruthSource,
          operationsAllocated: financialMetrics.systemChargeTruthSource,
          nftPoolLiveBalance: 'live_wallet_balance',
          operationsLiveBalance: 'live_wallet_balance',
          recycleAllocated: 'indexed_activation_summaries',
          recyclePaidLiquid: 'indexed_recycle_receipts',
          recycleEscrowLocked: 'indexed_recycle_receipts',
        },

        // Useful counts for confidence/status.
        paidActivationCount: financialMetrics.paidActivationCount,
        founderRepFreeActivationCount: financialMetrics.founderRepFreeActivationCount,

        // Old aliases for existing frontend code.
        totalGross: formatUsdt(financialMetrics.totalGeneratedRaw),
        totalLiquid: formatUsdt(financialMetrics.totalWalletCreditedRaw),
        totalEscrow: formatUsdt(financialMetrics.escrowLockedLifetimeRaw),

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
// import { safeRpcCall } from '../../blockchain/provider.js';
// import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
// import CommunityEvent from '../../models/CommunityEvent.js';
// import CommunitySocialLink from '../../models/CommunitySocialLink.js';
// import CommunityResource from '../../models/CommunityResource.js';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';

// const CACHE_TTL_MS = 15000;
// const cache = new Map();
// const inflight = new Map();

// function getCache(key) {
//   const hit = cache.get(key);
//   if (!hit) return null;
//   if (Date.now() > hit.expiresAt) {
//     cache.delete(key);
//     return null;
//   }
//   return hit.value;
// }

// function setCache(key, value, ttlMs = CACHE_TTL_MS) {
//   cache.set(key, {
//     value,
//     expiresAt: Date.now() + ttlMs,
//   });
// }


// async function fetchTreasuryBreakdown(contracts) {
//   const usdt = contracts?.usdt
//   const levelManager = contracts?.levelManager

//   if (!usdt || !levelManager) {
//     return {
//       nftPool: '0.00',
//       operations: '0.00',
//     }
//   }

//   try {
//     const nftPoolAddress = await safeRpcCall(() =>
//       levelManager.nftPool()
//     )

//     const opsAddress = await safeRpcCall(() =>
//       levelManager.operationsWallet()
//     )

//     const [nftRaw, opsRaw] = await Promise.all([
//       safeBalanceOf(usdt, nftPoolAddress),
//       safeBalanceOf(usdt, opsAddress),
//     ])

//     return {
//       nftPool: formatUsdt(nftRaw),
//       operations: formatUsdt(opsRaw),
//     }
//   } catch {
//     return {
//       nftPool: '0.00',
//       operations: '0.00',
//     }
//   }
// }

// async function cached(key, fn, ttlMs = CACHE_TTL_MS) {
//   const existing = getCache(key);
//   if (existing) return existing;

//   if (inflight.has(key)) {
//     return inflight.get(key);
//   }

//   const promise = (async () => {
//     try {
//       const result = await fn();
//       setCache(key, result, ttlMs);
//       return result;
//     } finally {
//       inflight.delete(key);
//     }
//   })();

//   inflight.set(key, promise);
//   return promise;
// }

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
//     const value = await safeRpcCall(() => usdtContract.balanceOf(address));
//     return BigInt(value || 0);
//   } catch {
//     return 0n;
//   }
// }

// async function fetchTotalParticipants(contracts) {
//   if (!contracts?.registration) return 0;

//   try {
//     const totalParticipantsRaw = await safeRpcCall(() => contracts.registration.totalParticipants());
//     const count = Number(totalParticipantsRaw || 0);
//     if (count > 0) return count;
//   } catch {
//     // fall back
//   }

//   try {
//     return await IndexedRegistrationEvent.countDocuments({
//       eventName: 'Registered',
//     });
//   } catch {
//     return 0;
//   }
// }

// async function fetchVisibleCoreBalance(contracts) {
//   let totalCommunityValueRaw = 0n;

//   try {
//     const receipts = await IndexedReceipt.find({})
//       .select('grossAmount')
//       .lean();

//     totalCommunityValueRaw = receipts.reduce((acc, receipt) => {
//       try {
//         return acc + BigInt(receipt.grossAmount || '0');
//       } catch {
//         return acc;
//       }
//     }, 0n);
//   } catch {
//     totalCommunityValueRaw = 0n;
//   }

//   let onChainBalanceRaw = 0n;
//   const usdtContract = contracts?.usdt;

//   if (usdtContract) {
//     const escrowAddress = getContractAddress(contracts.escrow);
//     const p4Address = getContractAddress(contracts.p4Orbit);
//     const p12Address = getContractAddress(contracts.p12Orbit);
//     const p39Address = getContractAddress(contracts.p39Orbit);

//     try {
//       const [escrowRaw, p4Raw, p12Raw, p39Raw] = await Promise.all([
//         safeBalanceOf(usdtContract, escrowAddress),
//         safeBalanceOf(usdtContract, p4Address),
//         safeBalanceOf(usdtContract, p12Address),
//         safeBalanceOf(usdtContract, p39Address),
//       ]);

//       onChainBalanceRaw =
//         BigInt(escrowRaw || 0) +
//         BigInt(p4Raw || 0) +
//         BigInt(p12Raw || 0) +
//         BigInt(p39Raw || 0);
//     } catch {
//       onChainBalanceRaw = 0n;
//     }
//   }

//   return totalCommunityValueRaw > onChainBalanceRaw
//     ? totalCommunityValueRaw
//     : onChainBalanceRaw;
// }



// export async function fetchCommunitySummary() {
//   return cached('community:summary', async () => {
//     const contracts = getContracts();

//     const [totalParticipants, visibleCoreBalanceRaw,  treasury, announcementCount, eventCount, socialCount, resourceCount, receiptCount] =
//       await Promise.all([
//         fetchTotalParticipants(contracts),
//         fetchVisibleCoreBalance(contracts),
//         fetchTreasuryBreakdown(contracts), 
//         CommunityAnnouncement.countDocuments({ isActive: true }).catch(() => 0),
//         CommunityEvent.countDocuments({ isActive: true }).catch(() => 0),
//         CommunitySocialLink.countDocuments({ isActive: true }).catch(() => 0),
//         CommunityResource.countDocuments({ isActive: true }).catch(() => 0),
//         IndexedReceipt.countDocuments().catch(() => 0),
//       ]);

//     // return {
//     //   public: {
//     //     totalParticipants,
//     //     visibleCoreBalanceUsdt: formatUsdt(visibleCoreBalanceRaw),
//     //     readLayerStatus: totalParticipants > 0 ? 'Live' : 'Syncing',
//     //   },
//     //   feeds: {
//     //     announcements: announcementCount > 0 ? 'live' : 'unavailable',
//     //     events: eventCount > 0 ? 'live' : 'unavailable',
//     //     socialLinks: socialCount > 0 ? 'live' : 'unavailable',
//     //     resources: resourceCount > 0 ? 'live' : 'unavailable',
//     //     leaderboard: receiptCount > 0 ? 'live' : 'unavailable',
//     //     growth: totalParticipants > 0 ? 'live' : 'unavailable',
//     //   },
//     // };
//     return {
//         public: {
//           totalParticipants,
//           visibleCoreBalanceUsdt: formatUsdt(visibleCoreBalanceRaw),

//           nftPool: treasury?.nftPool || '0.00',
//           operations: treasury?.operations || '0.00',

//           readLayerStatus: totalParticipants > 0 ? 'Live' : 'Syncing',
//         },
//         feeds: {
//           announcements: announcementCount > 0 ? 'live' : 'unavailable',
//           events: eventCount > 0 ? 'live' : 'unavailable',
//           socialLinks: socialCount > 0 ? 'live' : 'unavailable',
//           resources: resourceCount > 0 ? 'live' : 'unavailable',
//           leaderboard: receiptCount > 0 ? 'live' : 'unavailable',
//           growth: totalParticipants > 0 ? 'live' : 'unavailable',
//         },
//       }
//   });
// }

// export async function fetchCommunityAnnouncements() {
//   return cached('community:announcements', async () => {
//     const items = await CommunityAnnouncement.find({ isActive: true })
//       .sort({ priority: -1, createdAt: -1 })
//       .lean();

//     return {
//       status: items.length ? 'live' : 'unavailable',
//       items,
//     };
//   });
// }

// export async function fetchCommunityEvents() {
//   return cached('community:events', async () => {
//     const items = await CommunityEvent.find({ isActive: true })
//       .sort({ priority: -1, startAt: 1, createdAt: -1 })
//       .lean();

//     return {
//       status: items.length ? 'live' : 'unavailable',
//       items,
//     };
//   });
// }

// export async function fetchCommunitySocialLinks() {
//   return cached('community:social-links', async () => {
//     const items = await CommunitySocialLink.find({ isActive: true })
//       .sort({ sortOrder: 1, createdAt: 1 })
//       .lean();

//     return {
//       status: items.length ? 'live' : 'unavailable',
//       items,
//     };
//   });
// }

// export async function fetchCommunityResources() {
//   return cached('community:resources', async () => {
//     const items = await CommunityResource.find({ isActive: true })
//       .sort({ sortOrder: 1, createdAt: 1 })
//       .lean();

//     return {
//       status: items.length ? 'live' : 'unavailable',
//       items,
//     };
//   });
// }
