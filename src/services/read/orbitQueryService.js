import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
import IndexedTokenEvent from '../../models/IndexedTokenEvent.js';
import IndexedEscrowEvent from '../../models/IndexedEscrowEvent.js';
import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
import OrbitPositionSnapshot from '../../models/OrbitPositionSnapshot.js';
import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';
import { buildOrbitLevelSnapshot } from '../snapshots/orbitLevelSnapshotBuilder.js';
import { buildOrbitPositionSnapshot } from '../snapshots/orbitPositionSnapshotBuilder.js';
import { buildOrbitCycleSnapshot } from '../snapshots/orbitCycleSnapshotBuilder.js';
import { enrichOrbitLevelSnapshot } from '../snapshots/orbitLevelSnapshotEnricher.js';

import env from '../../config/env.js';

const RECEIPT_TYPES = {
  FOUNDER_PATH: 1,
  DIRECT_OWNER: 2,
  ROUTED_SPILLOVER: 3,
  RECYCLE: 4,
};

const levelToOrbitType = {
  1: 'P4',
  2: 'P12',
  3: 'P39',
  4: 'P4',
  5: 'P12',
  6: 'P39',
  7: 'P4',
  8: 'P12',
  9: 'P39',
  10: 'P4',
};



const LEVEL_CONFIG = {
  1: { price: 10, upgradeReq: 20, nextLevel: 2 },
  2: { price: 20, upgradeReq: 40, nextLevel: 3 },
  3: { price: 40, upgradeReq: 80, nextLevel: 4 },
  4: { price: 80, upgradeReq: 160, nextLevel: 5 },
  5: { price: 160, upgradeReq: 320, nextLevel: 6 },
  6: { price: 320, upgradeReq: 640, nextLevel: 7 },
  7: { price: 640, upgradeReq: 1280, nextLevel: 8 },
  8: { price: 1280, upgradeReq: 2560, nextLevel: 9 },
  9: { price: 2560, upgradeReq: 5120, nextLevel: 10 },
  10: { price: 5120, upgradeReq: 0, nextLevel: null },
};

const orbitTypeToContractKey = {
  P4: 'p4Orbit',
  P12: 'p12Orbit',
  P39: 'p39Orbit',
};

const RESPONSE_CACHE_TTL_MS = Number(env.API_CACHE_TTL_MS) || 15000;
const LEVEL_SNAPSHOT_TTL_MS = 15000;
const POSITION_SNAPSHOT_TTL_MS = 15000;
const CYCLE_SNAPSHOT_TTL_MS = 30000;
const CACHE_MAX_ENTRIES = 1000;
const CYCLE_WARM_BATCH_SIZE = 3;
const LEVELS_FETCH_CONCURRENCY = 3;

const inflightCache = new Map();
const responseCache = new Map();

const backgroundLevelRefreshes = new Map();
const backgroundPositionRefreshes = new Map();
const backgroundCycleRefreshes = new Map();
const backgroundCycleWarmups = new Map();

function safeApiResponse(fn, fallback) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error('[API_FAILSAFE]', error);
      return fallback;
    }
  };
}

async function safeOptionalRpc(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function isDebugLoggingEnabled() {
  return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
}

function logDebug(...args) {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
}

function pruneResponseCacheIfNeeded() {
  if (responseCache.size <= CACHE_MAX_ENTRIES) return;

  const oldestKey = responseCache.keys().next().value;
  if (oldestKey !== undefined) {
    responseCache.delete(oldestKey);
  }
}

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

  pruneResponseCacheIfNeeded();
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

function isSnapshotStale(snapshot, ttlMs) {
  if (!snapshot) return true;

  const builtAt =
    snapshot?.metadata?.enrichedAt ||
    snapshot?.metadata?.builtAt ||
    snapshot?.updatedAt ||
    null;

  if (!builtAt) return true;

  const builtMs = new Date(builtAt).getTime();
  if (!Number.isFinite(builtMs)) return true;

  return Date.now() - builtMs > ttlMs;
}

function getSnapshotFreshnessBlock(snapshot) {
  return Number(
    snapshot?.metadata?.freshnessBlock ||
      snapshot?.metadata?.builtFromBlock ||
      0
  );
}

function getSnapshotBuiltAtMs(snapshot) {
  const builtAt =
    snapshot?.metadata?.enrichedAt ||
    snapshot?.metadata?.builtAt ||
    snapshot?.updatedAt ||
    null;

  if (!builtAt) return 0;

  const builtMs = new Date(builtAt).getTime();
  return Number.isFinite(builtMs) ? builtMs : 0;
}

async function rebuildAndEnrichLevelSnapshot(address, level) {
  await buildOrbitLevelSnapshot(address, level);
  await enrichOrbitLevelSnapshot(address, level);

  return OrbitLevelSnapshot.findOne({
    address,
    level,
  }).lean();
}

async function rebuildPositionSnapshot(address, level, position) {
  await buildOrbitPositionSnapshot(address, level, position);

  return OrbitPositionSnapshot.findOne({
    address,
    level,
    position,
  }).lean();
}

async function rebuildCycleSnapshot(address, level, cycleNumber) {
  await buildOrbitCycleSnapshot(address, level, cycleNumber);

  return OrbitCycleSnapshot.findOne({
    address,
    level,
    cycleNumber,
  }).lean();
}

function scheduleBackgroundJob(jobMap, key, handler) {
  if (jobMap.has(key)) {
    return jobMap.get(key);
  }

  const job = (async () => {
    try {
      await handler();
    } catch (error) {
      console.error(`[BACKGROUND_JOB_FAILED] ${key}`, error);
    } finally {
      jobMap.delete(key);
    }
  })();

  jobMap.set(key, job);
  return job;
}

function refreshLevelSnapshotInBackground(address, level) {
  const key = `${address}:${level}`;

  return scheduleBackgroundJob(backgroundLevelRefreshes, key, async () => {
    logDebug('[LEVEL_REFRESH_BG_START]', { address, level });
    await rebuildAndEnrichLevelSnapshot(address, level);
    responseCache.delete(`orbit-level-snapshot:${address}:${level}`);
    logDebug('[LEVEL_REFRESH_BG_DONE]', { address, level });
  });
}

function refreshPositionSnapshotInBackground(address, level, position) {
  const key = `${address}:${level}:${position}`;

  return scheduleBackgroundJob(backgroundPositionRefreshes, key, async () => {
    logDebug('[POSITION_REFRESH_BG_START]', { address, level, position });
    await rebuildPositionSnapshot(address, level, position);
    responseCache.delete(`orbit-position-details:${address}:${level}:${position}`);
    logDebug('[POSITION_REFRESH_BG_DONE]', { address, level, position });
  });
}

function refreshCycleSnapshotInBackground(address, level, cycleNumber) {
  const key = `${address}:${level}:${cycleNumber}`;

  return scheduleBackgroundJob(backgroundCycleRefreshes, key, async () => {
    logDebug('[CYCLE_REFRESH_BG_START]', { address, level, cycleNumber });
    await rebuildCycleSnapshot(address, level, cycleNumber);
    responseCache.delete(`orbit-cycle-snapshot:${address}:${level}:${cycleNumber}`);
    logDebug('[CYCLE_REFRESH_BG_DONE]', { address, level, cycleNumber });
  });
}

function warmCycleSnapshotsInBackground(address, level, totalCycles) {
  const cycleCount = Number(totalCycles || 0);
  if (cycleCount <= 0) return;

  const warmKey = `${address}:${level}:${cycleCount}`;

  scheduleBackgroundJob(backgroundCycleWarmups, warmKey, async () => {
    const cycleNumbers = Array.from({ length: cycleCount }, (_, i) => i + 1);

    for (let i = 0; i < cycleNumbers.length; i += CYCLE_WARM_BATCH_SIZE) {
      const batch = cycleNumbers.slice(i, i + CYCLE_WARM_BATCH_SIZE);

      await Promise.all(
        batch.map(async (cycleNumber) => {
          const existing = await OrbitCycleSnapshot.findOne({
            address,
            level,
            cycleNumber,
          })
            .select({ updatedAt: 1, metadata: 1 })
            .lean();

          if (!isSnapshotStale(existing, CYCLE_SNAPSHOT_TTL_MS)) {
            return;
          }

          try {
            await buildOrbitCycleSnapshot(address, level, cycleNumber);
            responseCache.delete(`orbit-cycle-snapshot:${address}:${level}:${cycleNumber}`);
          } catch (error) {
            console.error(
              `[CYCLE_WARM_FAILED] address=${address} level=${level} cycle=${cycleNumber}`,
              error
            );
          }
        })
      );
    }

    logDebug('[CYCLE_WARM_DONE]', { address, level, totalCycles: cycleCount });
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) break;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeAddress(address) {
  if (!ethers.isAddress(address)) {
    const error = new Error('Invalid wallet address');
    error.status = 400;
    throw error;
  }

  return address.toLowerCase();
}

function validateLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    const error = new Error('Invalid level');
    error.status = 400;
    throw error;
  }
}

function validateCycleNumber(cycleNumber) {
  if (!Number.isInteger(cycleNumber) || cycleNumber < 1) {
    const error = new Error('Invalid cycle number');
    error.status = 400;
    throw error;
  }
}

function validatePosition(position, max) {
  if (!Number.isInteger(position) || position < 1 || position > max) {
    const error = new Error('Invalid position');
    error.status = 400;
    throw error;
  }
}

function formatUsdt(value) {
  try {
    return ethers.formatUnits(value ?? 0, 6);
  } catch {
    return '0.0';
  }
}

function addBigIntStrings(a, b) {
  return (BigInt(a || '0') + BigInt(b || '0')).toString();
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

function maxBigInt(a, b) {
  return a > b ? a : b;
}

function buildEmptyReceiptTotals() {
  return {
    count: 0,
    gross: '0',
    escrowLocked: '0',
    liquidPaid: '0',
    founderPathGross: '0',
    directOwnerGross: '0',
    routedSpilloverGross: '0',
    recycleGross: '0',
  };
}

function buildEmptyViewerBreakdown() {
  return {
    count: 0,
    totalGross: '0',
    totalLiquid: '0',
    totalEscrow: '0',
    founderPathGross: '0',
    founderPathLiquid: '0',
    founderPathEscrow: '0',
    directOwnerGross: '0',
    directOwnerLiquid: '0',
    directOwnerEscrow: '0',
    routedSpilloverGross: '0',
    routedSpilloverLiquid: '0',
    routedSpilloverEscrow: '0',
    recycleGross: '0',
    recycleLiquid: '0',
    recycleEscrow: '0',
  };
}

function getOrbitPositionCount(orbitType) {
  if (orbitType === 'P4') return 4;
  if (orbitType === 'P12') return 12;
  return 39;
}

function getLineForPosition(orbitType, position) {
  if (orbitType === 'P4') return 1;
  if (orbitType === 'P12') return position <= 3 ? 1 : 2;
  if (orbitType === 'P39') {
    if (position <= 3) return 1;
    if (position <= 12) return 2;
    return 3;
  }
  return 1;
}

function getStructuralParentPosition(orbitType, position) {
  if (orbitType === 'P4') return null;

  if (orbitType === 'P12') {
    if ([4, 7, 10].includes(position)) return 1;
    if ([5, 8, 11].includes(position)) return 2;
    if ([6, 9, 12].includes(position)) return 3;
    return null;
  }

  if (orbitType === 'P39') {
    if ([4, 7, 10].includes(position)) return 1;
    if ([5, 8, 11].includes(position)) return 2;
    if ([6, 9, 12].includes(position)) return 3;
    if ([13, 22, 31].includes(position)) return 4;
    if ([14, 23, 32].includes(position)) return 5;
    if ([15, 24, 33].includes(position)) return 6;
    if ([16, 25, 34].includes(position)) return 7;
    if ([17, 26, 35].includes(position)) return 8;
    if ([18, 27, 36].includes(position)) return 9;
    if ([19, 28, 37].includes(position)) return 10;
    if ([20, 29, 38].includes(position)) return 11;
    if ([21, 30, 39].includes(position)) return 12;
    return null;
  }

  return null;
}

function getTruthLabelFromReceipts(receipts) {
  if (!receipts || receipts.length === 0) return 'NO_RECEIPT';

  const types = new Set(receipts.map((r) => Number(r.receiptType || 0)));

  if (types.has(RECEIPT_TYPES.FOUNDER_PATH)) return 'FOUNDER_PATH';
  if (
    types.has(RECEIPT_TYPES.DIRECT_OWNER) &&
    types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)
  ) {
    return 'DIRECT_AND_ROUTED';
  }
  if (types.has(RECEIPT_TYPES.DIRECT_OWNER)) return 'DIRECT_OWNER';
  if (types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)) return 'ROUTED_SPILLOVER';
  if (types.has(RECEIPT_TYPES.RECYCLE)) return 'RECYCLE';

  return 'UNKNOWN';
}

function normalizeRuleView(ruleResult) {
  if (!ruleResult) return null;

  const isHistorical =
    ruleResult.hasStoredRuleData !== undefined ||
    (Array.isArray(ruleResult) && ruleResult.length >= 13);

  if (isHistorical) {
    return {
      cycleNumber: Number(ruleResult.cycleNumber ?? ruleResult[0] ?? 0),
      position: Number(ruleResult.position ?? ruleResult[1] ?? 0),
      line: Number(ruleResult.line ?? ruleResult[2] ?? 0),
      linePaymentNumber: Number(
        ruleResult.linePaymentNumber ?? ruleResult[3] ?? 0
      ),
      autoUpgradeEnabled: Boolean(
        ruleResult.autoUpgradeEnabled ?? ruleResult[4] ?? false
      ),
      hasStoredRuleData: Boolean(
        ruleResult.hasStoredRuleData ?? ruleResult[5] ?? false
      ),
      isFounderNoReferrerPath: false,
      toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[6] ?? 0),
      toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[7] ?? 0),
      toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[8] ?? 0),
      toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[9] ?? 0),
      toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[10] ?? 0),
      spillover1Recipient:
        ruleResult.spillover1Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
      spillover2Recipient:
        ruleResult.spillover2Recipient ?? ruleResult[12] ?? ethers.ZeroAddress,
    };
  }

  return {
    position: Number(ruleResult.position ?? ruleResult[0] ?? 0),
    line: Number(ruleResult.line ?? ruleResult[1] ?? 0),
    linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[2] ?? 0),
    autoUpgradeEnabled: Boolean(
      ruleResult.autoUpgradeEnabled ?? ruleResult[3] ?? false
    ),
    isFounderNoReferrerPath: Boolean(
      ruleResult.isFounderNoReferrerPath ?? ruleResult[4] ?? false
    ),
    hasStoredRuleData: false,
    toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[5] ?? 0),
    toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[6] ?? 0),
    toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[7] ?? 0),
    toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[8] ?? 0),
    toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[9] ?? 0),
    spillover1Recipient:
      ruleResult.spillover1Recipient ?? ruleResult[10] ?? ethers.ZeroAddress,
    spillover2Recipient:
      ruleResult.spillover2Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
  };
}

async function getOrbitContext(level) {
  validateLevel(level);

  const orbitType = levelToOrbitType[level];
  const contractKey = orbitTypeToContractKey[orbitType];
  const contracts = getContracts();

  if (!orbitType || !contractKey || !contracts[contractKey]) {
    const error = new Error(`Unsupported level: ${level}`);
    error.status = 400;
    throw error;
  }

  return {
    contracts,
    orbitType,
    orbitContract: contracts[contractKey],
    positionsCount: getOrbitPositionCount(orbitType),
  };
}

async function tryCall(contract, methodNames, args) {
  for (const methodName of methodNames) {
    if (typeof contract?.[methodName] === 'function') {
      try {
        const result = await safeOptionalRpc(() => contract[methodName](...args));
        return { ok: true, methodName, result };
      } catch {
        // continue
      }
    }
  }

  return { ok: false, methodName: null, result: null };
}

function summarizeReceiptsForViewer(receipts, viewedAddress) {
  const totals = buildEmptyReceiptTotals();
  const viewer = buildEmptyViewerBreakdown();
  const lowerViewed = viewedAddress.toLowerCase();

  for (const receipt of receipts) {
    totals.count += 1;
    totals.gross = addBigIntStrings(totals.gross, receipt.grossAmount);
    totals.escrowLocked = addBigIntStrings(
      totals.escrowLocked,
      receipt.escrowLocked
    );
    totals.liquidPaid = addBigIntStrings(totals.liquidPaid, receipt.liquidPaid);

    const type = Number(receipt.receiptType || 0);

    if (type === RECEIPT_TYPES.FOUNDER_PATH) {
      totals.founderPathGross = addBigIntStrings(
        totals.founderPathGross,
        receipt.grossAmount
      );
    } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
      totals.directOwnerGross = addBigIntStrings(
        totals.directOwnerGross,
        receipt.grossAmount
      );
    } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
      totals.routedSpilloverGross = addBigIntStrings(
        totals.routedSpilloverGross,
        receipt.grossAmount
      );
    } else if (type === RECEIPT_TYPES.RECYCLE) {
      totals.recycleGross = addBigIntStrings(
        totals.recycleGross,
        receipt.grossAmount
      );
    }

    if ((receipt.receiver || '').toLowerCase() !== lowerViewed) continue;

    viewer.count += 1;
    viewer.totalGross = addBigIntStrings(viewer.totalGross, receipt.grossAmount);
    viewer.totalLiquid = addBigIntStrings(
      viewer.totalLiquid,
      receipt.liquidPaid
    );
    viewer.totalEscrow = addBigIntStrings(
      viewer.totalEscrow,
      receipt.escrowLocked
    );

    if (type === RECEIPT_TYPES.FOUNDER_PATH) {
      viewer.founderPathGross = addBigIntStrings(
        viewer.founderPathGross,
        receipt.grossAmount
      );
      viewer.founderPathLiquid = addBigIntStrings(
        viewer.founderPathLiquid,
        receipt.liquidPaid
      );
      viewer.founderPathEscrow = addBigIntStrings(
        viewer.founderPathEscrow,
        receipt.escrowLocked
      );
    } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
      viewer.directOwnerGross = addBigIntStrings(
        viewer.directOwnerGross,
        receipt.grossAmount
      );
      viewer.directOwnerLiquid = addBigIntStrings(
        viewer.directOwnerLiquid,
        receipt.liquidPaid
      );
      viewer.directOwnerEscrow = addBigIntStrings(
        viewer.directOwnerEscrow,
        receipt.escrowLocked
      );
    } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
      viewer.routedSpilloverGross = addBigIntStrings(
        viewer.routedSpilloverGross,
        receipt.grossAmount
      );
      viewer.routedSpilloverLiquid = addBigIntStrings(
        viewer.routedSpilloverLiquid,
        receipt.liquidPaid
      );
      viewer.routedSpilloverEscrow = addBigIntStrings(
        viewer.routedSpilloverEscrow,
        receipt.escrowLocked
      );
    } else if (type === RECEIPT_TYPES.RECYCLE) {
      viewer.recycleGross = addBigIntStrings(
        viewer.recycleGross,
        receipt.grossAmount
      );
      viewer.recycleLiquid = addBigIntStrings(
        viewer.recycleLiquid,
        receipt.liquidPaid
      );
      viewer.recycleEscrow = addBigIntStrings(
        viewer.recycleEscrow,
        receipt.escrowLocked
      );
    }
  }

  return {
    totals: {
      count: totals.count,
      gross: formatUsdt(totals.gross),
      escrowLocked: formatUsdt(totals.escrowLocked),
      liquidPaid: formatUsdt(totals.liquidPaid),
      founderPathGross: formatUsdt(totals.founderPathGross),
      directOwnerGross: formatUsdt(totals.directOwnerGross),
      routedSpilloverGross: formatUsdt(totals.routedSpilloverGross),
      recycleGross: formatUsdt(totals.recycleGross),
    },
    viewerBreakdown: {
      count: viewer.count,
      totalGross: formatUsdt(viewer.totalGross),
      totalLiquid: formatUsdt(viewer.totalLiquid),
      totalEscrow: formatUsdt(viewer.totalEscrow),
      founderPathGross: formatUsdt(viewer.founderPathGross),
      founderPathLiquid: formatUsdt(viewer.founderPathLiquid),
      founderPathEscrow: formatUsdt(viewer.founderPathEscrow),
      directOwnerGross: formatUsdt(viewer.directOwnerGross),
      directOwnerLiquid: formatUsdt(viewer.directOwnerLiquid),
      directOwnerEscrow: formatUsdt(viewer.directOwnerEscrow),
      routedSpilloverGross: formatUsdt(viewer.routedSpilloverGross),
      routedSpilloverLiquid: formatUsdt(viewer.routedSpilloverLiquid),
      routedSpilloverEscrow: formatUsdt(viewer.routedSpilloverEscrow),
      recycleGross: formatUsdt(viewer.recycleGross),
      recycleLiquid: formatUsdt(viewer.recycleLiquid),
      recycleEscrow: formatUsdt(viewer.recycleEscrow),
    },
    truthLabel: getTruthLabelFromReceipts(receipts),
  };
}

async function fetchIndexedReceiptsForActivation(activationId) {
  if (!activationId || Number(activationId) <= 0) return [];

  return IndexedReceipt.find({
    activationId: String(activationId),
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
}

async function fetchLiveRuleView(orbitContract, address, level, position) {
  const call = await tryCall(
    orbitContract,
    ['getPositionRuleView'],
    [address, level, position]
  );

  return call.ok ? normalizeRuleView(call.result) : null;
}

async function fetchHistoricalRuleView(
  orbitContract,
  address,
  level,
  cycleNumber,
  position
) {
  const call = await tryCall(
    orbitContract,
    ['getHistoricalPositionRuleView'],
    [address, level, cycleNumber, position]
  );

  return call.ok ? normalizeRuleView(call.result) : null;
}

async function fetchLiveActivationData(orbitContract, address, level, position) {
  if (typeof orbitContract.getPositionActivationData !== 'function') {
    return {
      activationId: 0,
      activationCycleNumber: 0,
      isMirrorActivation: false,
    };
  }

  const result = await safeOptionalRpc(() =>
    orbitContract.getPositionActivationData(address, level, position)
  );

  if (!result) {
    return {
      activationId: 0,
      activationCycleNumber: 0,
      isMirrorActivation: false,
    };
  }

  return {
    activationId: Number(result?.activationId ?? result?.[0] ?? 0),
    activationCycleNumber: Number(result?.cycleNumber ?? result?.[1] ?? 0),
    isMirrorActivation: Boolean(result?.isMirror ?? result?.[2] ?? false),
  };
}

async function fetchHistoricalActivationData(
  orbitContract,
  address,
  level,
  cycleNumber,
  position
) {
  if (typeof orbitContract.getHistoricalPositionActivationData !== 'function') {
    return {
      activationId: 0,
      activationCycleNumber: cycleNumber,
      isMirrorActivation: false,
    };
  }

  const result = await safeOptionalRpc(() =>
    orbitContract.getHistoricalPositionActivationData(
      address,
      level,
      cycleNumber,
      position
    )
  );

  if (!result) {
    return {
      activationId: 0,
      activationCycleNumber: cycleNumber,
      isMirrorActivation: false,
    };
  }

  return {
    activationId: Number(result?.activationId ?? result?.[0] ?? 0),
    activationCycleNumber: cycleNumber,
    isMirrorActivation: Boolean(result?.isMirror ?? result?.[1] ?? false),
  };
}

function shapeIndexedReceipts(receipts) {
  return receipts.map((receipt) => ({
    txHash: receipt.txHash,
    logIndex: receipt.logIndex,
    blockNumber: receipt.blockNumber,
    receiver: receipt.receiver,
    activationId: receipt.activationId,
    receiptType: receipt.receiptType,
    level: receipt.level,
    fromUser: receipt.fromUser,
    orbitOwner: receipt.orbitOwner,
    sourcePosition: receipt.sourcePosition,
    sourceCycle: receipt.sourceCycle,
    mirroredPosition: receipt.mirroredPosition,
    mirroredCycle: receipt.mirroredCycle,
    routedRole: receipt.routedRole,
    grossAmount: formatUsdt(receipt.grossAmount),
    escrowLocked: formatUsdt(receipt.escrowLocked),
    liquidPaid: formatUsdt(receipt.liquidPaid),
    timestamp: receipt.timestamp,
    rawEventName: receipt.rawEventName,
  }));
}

// FIX 4: Safest findBestIndexedPositionFilledEvent
function findBestIndexedPositionFilledEvent(indexedEvents = []) {
  const sorted = [...indexedEvents].sort(
    (a, b) =>
      Number(a.blockNumber || 0) - Number(b.blockNumber || 0) ||
      Number(a.logIndex || 0) - Number(b.logIndex || 0)
  );

  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

function findActivationIdFromIndexedReceipts(
  receipts = [],
  cycleNumber,
  positionNumber
) {
  const match = receipts.find(
    (receipt) =>
      Number(receipt.sourceCycle || 0) === Number(cycleNumber) &&
      Number(receipt.sourcePosition || 0) === Number(positionNumber) &&
      Number(receipt.activationId || 0) > 0
  );

  return match ? Number(match.activationId) : 0;
}

async function fetchIndexedReceiptsForHistoricalPosition(
  orbitOwner,
  level,
  cycleNumber,
  positionNumber
) {
  return IndexedReceipt.find({
    orbitOwner: orbitOwner.toLowerCase(),
    level,
    sourceCycle: Number(cycleNumber),
    sourcePosition: Number(positionNumber),
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
}

// FIX 1: Replace unsafe grouped event function
async function getIndexedOrbitEventsForLevel(orbitOwner, level, orbitType) {
  return IndexedOrbitEvent.find({
    orbitOwner: orbitOwner.toLowerCase(),
    level,
    orbitType,
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
}

async function getLatestIndexedActivityForLevel(address, level, orbitType) {
  const [latestEvent, latestReceipt] = await Promise.all([
    IndexedOrbitEvent.findOne({
      orbitOwner: address,
      level,
      orbitType,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),

    IndexedReceipt.findOne({
      orbitOwner: address,
      level,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),
  ]);

  const latestBlock = Math.max(
    Number(latestEvent?.blockNumber || 0),
    Number(latestReceipt?.blockNumber || 0)
  );

  const latestUpdatedAtMs = Math.max(
    new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
    new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
  );

  return {
    latestBlock,
    latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
  };
}

async function getLatestIndexedActivityForPosition(address, level, orbitType, position) {
  const [latestEvent, latestReceipt] = await Promise.all([
    IndexedOrbitEvent.findOne({
      orbitOwner: address,
      level,
      orbitType,
      position,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),

    IndexedReceipt.findOne({
      orbitOwner: address,
      level,
      sourcePosition: position,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),
  ]);

  const latestBlock = Math.max(
    Number(latestEvent?.blockNumber || 0),
    Number(latestReceipt?.blockNumber || 0)
  );

  const latestUpdatedAtMs = Math.max(
    new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
    new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
  );

  return {
    latestBlock,
    latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
  };
}

async function getLatestIndexedActivityForCycle(address, level, orbitType, cycleNumber) {
  const [latestEvent, latestReceipt] = await Promise.all([
    IndexedOrbitEvent.findOne({
      orbitOwner: address,
      level,
      orbitType,
      cycleNumber,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),

    IndexedReceipt.findOne({
      orbitOwner: address,
      level,
      sourceCycle: cycleNumber,
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
      .lean(),
  ]);

  const latestBlock = Math.max(
    Number(latestEvent?.blockNumber || 0),
    Number(latestReceipt?.blockNumber || 0)
  );

  const latestUpdatedAtMs = Math.max(
    new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
    new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
  );

  return {
    latestBlock,
    latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
  };
}

function hasIndexedActivityAdvanced(snapshot, latestActivity) {
  if (!snapshot) return true;
  if (!latestActivity) return false;

  const snapshotFreshnessBlock = getSnapshotFreshnessBlock(snapshot);
  const snapshotBuiltAtMs = getSnapshotBuiltAtMs(snapshot);

  if (Number(latestActivity.latestBlock || 0) > snapshotFreshnessBlock) {
    return true;
  }

  if (
    Number(latestActivity.latestUpdatedAtMs || 0) > 0 &&
    Number(latestActivity.latestUpdatedAtMs || 0) > snapshotBuiltAtMs
  ) {
    return true;
  }

  return false;
}

async function buildLivePositionSnapshot(address, level, positionNumber, preloaded = {}) {
  const normalizedAddress = normalizeAddress(address);
  const { orbitType, orbitContract } = await getOrbitContext(level);

  const [position, activationData, ruleView] = await Promise.all([
    safeOptionalRpc(() =>
      orbitContract.getPosition(normalizedAddress, level, positionNumber)
    ),
    fetchLiveActivationData(orbitContract, normalizedAddress, level, positionNumber),
    fetchLiveRuleView(orbitContract, normalizedAddress, level, positionNumber),
  ]);

  // FIX 2: Live position event filtering
  const indexedEvents = (preloaded.allIndexedEvents || []).filter(
    (event) =>
      event.eventName === 'PositionFilled' &&
      Number(event.position || 0) === Number(positionNumber)
  );
  
  const occupant =
    position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
  const indexedReceipts = await fetchIndexedReceiptsForActivation(
    activationData.activationId
  );
  const receiptSummary = summarizeReceiptsForViewer(
    indexedReceipts,
    normalizedAddress
  );

  return {
    number: positionNumber,
    level,
    orbitType,
    line: getLineForPosition(orbitType, positionNumber),
    parentPosition: getStructuralParentPosition(orbitType, positionNumber),
    occupant,
    amount: occupant ? formatUsdt(position?.[1]) : '0.0',
    timestamp: Number(position?.[2] ?? 0),
    activationId: activationData.activationId,
    activationCycleNumber: activationData.activationCycleNumber,
    isMirrorActivation: activationData.isMirrorActivation,
    truthLabel: receiptSummary.truthLabel,
    indexedEventCount: indexedEvents.length,
    indexedReceiptCount: indexedReceipts.length,
    receiptTotals: receiptSummary.totals,
    viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
    indexedReceipts: shapeIndexedReceipts(indexedReceipts),
    indexedEvents,
    ruleView,
  };
}

async function buildHistoricalPositionSnapshot(
  address,
  level,
  cycleNumber,
  positionNumber,
  preloaded = {}
) {
  const normalizedAddress = normalizeAddress(address);
  const { orbitType, orbitContract } = await getOrbitContext(level);

  // FIX 3: Historical position event filtering
  const indexedEvents = (preloaded.allIndexedEvents || []).filter(
    (event) =>
      event.eventName === 'PositionFilled' &&
      Number(event.position || 0) === Number(positionNumber) &&
      Number(event.cycleNumber || 0) === Number(cycleNumber)
  );

  const indexedReceiptsForPosition =
    await fetchIndexedReceiptsForHistoricalPosition(
      normalizedAddress,
      level,
      cycleNumber,
      positionNumber
    );

  const historicalPositionCall = await tryCall(
    orbitContract,
    ['getHistoricalPosition', 'getCyclePosition', 'getStoredCyclePosition', 'getArchivedPosition'],
    [normalizedAddress, level, cycleNumber, positionNumber]
  );

  if (!historicalPositionCall.ok) {
    const error = new Error(
      'Historical position getter not supported by this orbit contract'
    );
    error.status = 400;
    throw error;
  }

  const position = historicalPositionCall.result || [];
  let occupant =
    position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
  let amount = occupant ? formatUsdt(position?.[1]) : '0.0';
  let timestamp = Number(position?.[2] ?? 0);

  const [activationDataRaw, ruleView] = await Promise.all([
    fetchHistoricalActivationData(
      orbitContract,
      normalizedAddress,
      level,
      cycleNumber,
      positionNumber
    ),
    fetchHistoricalRuleView(
      orbitContract,
      normalizedAddress,
      level,
      cycleNumber,
      positionNumber
    ),
  ]);

  let activationId = Number(activationDataRaw.activationId || 0);
  let activationCycleNumber = Number(
    activationDataRaw.activationCycleNumber || cycleNumber
  );
  let isMirrorActivation = Boolean(activationDataRaw.isMirrorActivation || false);

  const bestIndexedPositionFilled = findBestIndexedPositionFilledEvent(indexedEvents);

  if (!occupant && bestIndexedPositionFilled) {
    occupant = bestIndexedPositionFilled.user || null;

    if (bestIndexedPositionFilled.amount) {
      amount = formatUsdt(bestIndexedPositionFilled.amount);
    }

    if (bestIndexedPositionFilled.timestamp) {
      timestamp = Math.floor(
        new Date(bestIndexedPositionFilled.timestamp).getTime() / 1000
      );
    }
  }

  if (!activationId && indexedReceiptsForPosition.length > 0) {
    activationId = findActivationIdFromIndexedReceipts(
      indexedReceiptsForPosition,
      cycleNumber,
      positionNumber
    );
  }

  const indexedReceipts =
    activationId > 0
      ? await fetchIndexedReceiptsForActivation(activationId)
      : indexedReceiptsForPosition;

  const receiptSummary = summarizeReceiptsForViewer(
    indexedReceipts,
    normalizedAddress
  );

  let truthLabel = receiptSummary.truthLabel;
  if (truthLabel === 'NO_RECEIPT' && bestIndexedPositionFilled && occupant) {
    truthLabel = 'UNKNOWN';
  }

  return {
    number: positionNumber,
    level,
    cycleNumber,
    orbitType,
    line: getLineForPosition(orbitType, positionNumber),
    parentPosition: getStructuralParentPosition(orbitType, positionNumber),
    occupant,
    amount,
    timestamp,
    activationId,
    activationCycleNumber,
    isMirrorActivation,
    truthLabel,
    indexedEventCount: indexedEvents.length,
    indexedReceiptCount: indexedReceipts.length,
    receiptTotals: {
      ...receiptSummary.totals,
    },
    viewerReceiptBreakdown: {
      ...receiptSummary.viewerBreakdown,
    },
    indexedReceipts: shapeIndexedReceipts(indexedReceipts),
    indexedEvents,
    ruleView,
  };
}

export const fetchOrbitLevels = safeApiResponse(async function fetchOrbitLevels(address) {
  const normalizedAddress = normalizeAddress(address);
  const cacheKey = `orbit-levels:${normalizedAddress}`;

  return cached(
    cacheKey,
    async () => {
      const contracts = getContracts();

      const levels = await mapWithConcurrency(
        Array.from({ length: 10 }, (_, index) => index + 1),
        LEVELS_FETCH_CONCURRENCY,
        async (level) => {
          const isActive = await safeOptionalRpc(() =>
            contracts.registration.isLevelActivated(normalizedAddress, level)
          ) || false;

          return {
            level,
            orbitType: levelToOrbitType[level],
            isActive: Boolean(isActive),
          };
        }
      );

      const activeLevels = levels
        .filter((item) => item.isActive)
        .map((item) => item.level);

      const highestActiveLevel = activeLevels.length
        ? Math.max(...activeLevels)
        : 0;

      return {
        address: normalizedAddress,
        levels,
        highestActiveLevel,
      };
    },
    5000
  );
}, {
  address: null,
  levels: [],
  highestActiveLevel: 0
});

export const fetchOrbitLevelSnapshot = safeApiResponse(async function fetchOrbitLevelSnapshot(address, level) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);

  const orbitType = levelToOrbitType[level];
  const cacheKey = `orbit-level-snapshot:${normalizedAddress}:${level}`;

  return cached(
    cacheKey,
    async () => {
      let snapshot = await OrbitLevelSnapshot.findOne({
        address: normalizedAddress,
        level,
      }).lean();

      const latestActivity = await getLatestIndexedActivityForLevel(
        normalizedAddress,
        level,
        orbitType
      );

      const isMissing = !snapshot;
      const isIncomplete =
        !snapshot?.metadata?.completeness?.positionsReady ||
        !snapshot?.metadata?.completeness?.summaryReady;
      const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
      const isStale = isSnapshotStale(snapshot, LEVEL_SNAPSHOT_TTL_MS);

      if (isMissing) {
        logDebug('[LEVEL_SNAPSHOT_MISSING_REBUILD]', {
          address: normalizedAddress,
          level,
        });

        snapshot = await rebuildAndEnrichLevelSnapshot(
          normalizedAddress,
          level
        );

        if (!snapshot) {
          return {
            address: normalizedAddress,
            level,
            orbitType,
            isLevelActive: false,
            orbitSummary: {},
            linePaymentCounts: {},
            lockedForNextLevel: '0',
            positions: [],
            isFallback: true,
          };
        }
      }

      if (isIncomplete || hasNewIndexedActivity || isStale) {
        refreshLevelSnapshotInBackground(normalizedAddress, level);
      }

      const totalCycles = Number(snapshot?.orbitSummary?.totalCycles || 0);

      if (totalCycles > 0) {
        warmCycleSnapshotsInBackground(normalizedAddress, level, totalCycles);
      }

      return {
        address: normalizedAddress,
        level,
        orbitType,
        isLevelActive: snapshot.isLevelActive || false,
        orbitSummary: snapshot.orbitSummary || {},
        linePaymentCounts: snapshot.linePaymentCounts || {},
        lockedForNextLevel: snapshot.lockedForNextLevel || '0',
        positions: snapshot.positions || [],
      };
    },
    5000
  );
}, {
  address: null,
  level: 0,
  orbitType: null,
  isLevelActive: false,
  orbitSummary: {},
  linePaymentCounts: {},
  lockedForNextLevel: '0',
  positions: [],
  isFallback: true
});

export const fetchOrbitPositionDetails = safeApiResponse(async function fetchOrbitPositionDetails(address, level, position) {
  const { orbitType, positionsCount } = await getOrbitContext(level);
  validatePosition(position, positionsCount);

  const normalizedAddress = normalizeAddress(address);
  const cacheKey = `orbit-position-details:${normalizedAddress}:${level}:${position}`;

  return cached(
    cacheKey,
    async () => {
      let snapshot = await OrbitPositionSnapshot.findOne({
        address: normalizedAddress,
        level,
        position,
      }).lean();

      const latestActivity = await getLatestIndexedActivityForPosition(
        normalizedAddress,
        level,
        orbitType,
        position
      );

      const isMissing = !snapshot;
      const isIncomplete =
        !snapshot?.metadata?.completeness?.receiptsReady ||
        !snapshot?.metadata?.completeness?.eventsReady;
      const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
      const isStale = isSnapshotStale(snapshot, POSITION_SNAPSHOT_TTL_MS);

      if (isMissing) {
        logDebug('[POSITION_SNAPSHOT_MISSING_REBUILD]', {
          address: normalizedAddress,
          level,
          position,
        });

        snapshot = await rebuildPositionSnapshot(
          normalizedAddress,
          level,
          position
        );

        if (!snapshot) {
          return {
            address: normalizedAddress,
            level,
            position,
            orbitType,
            number: position,
            line: getLineForPosition(orbitType, position),
            parentPosition: getStructuralParentPosition(orbitType, position),
            occupant: null,
            amount: '0.0',
            timestamp: 0,
            activationId: 0,
            activationCycleNumber: 0,
            isMirrorActivation: false,
            truthLabel: 'NO_RECEIPT',
            indexedEventCount: 0,
            indexedReceiptCount: 0,
            receiptTotals: buildEmptyReceiptTotals(),
            viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
            indexedReceipts: [],
            indexedEvents: [],
            ruleView: null,
            isFallback: true,
          };
        }
      }

      if (isIncomplete || hasNewIndexedActivity || isStale) {
        refreshPositionSnapshotInBackground(
          normalizedAddress,
          level,
          position
        );
      }

      return {
        address: normalizedAddress,
        level,
        position,
        orbitType,
        number: snapshot.position,
        line: snapshot.line,
        parentPosition: snapshot.parentPosition,
        occupant: snapshot.occupant,
        amount: snapshot.amount,
        timestamp: snapshot.timestamp,
        activationId: snapshot.activationId,
        activationCycleNumber: snapshot.activationCycleNumber,
        isMirrorActivation: snapshot.isMirrorActivation,
        truthLabel: snapshot.truthLabel,
        indexedEventCount: snapshot.indexedEventCount,
        indexedReceiptCount: snapshot.indexedReceiptCount,
        receiptTotals: snapshot.receiptTotals,
        viewerReceiptBreakdown: snapshot.viewerReceiptBreakdown,
        indexedReceipts: snapshot.indexedReceipts || [],
        indexedEvents: snapshot.indexedEvents || [],
        ruleView: snapshot.ruleView || null,
      };
    },
    5000
  );
}, {
  address: null,
  level: 0,
  position: 0,
  orbitType: null,
  number: 0,
  line: 0,
  parentPosition: null,
  occupant: null,
  amount: '0.0',
  timestamp: 0,
  activationId: 0,
  activationCycleNumber: 0,
  isMirrorActivation: false,
  truthLabel: 'NO_RECEIPT',
  indexedEventCount: 0,
  indexedReceiptCount: 0,
  receiptTotals: buildEmptyReceiptTotals(),
  viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
  indexedReceipts: [],
  indexedEvents: [],
  ruleView: null,
  isFallback: true
});

export const fetchOrbitCycleSnapshot = safeApiResponse(async function fetchOrbitCycleSnapshot(address, level, cycleNumber) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);
  validateCycleNumber(cycleNumber);

  const orbitType = levelToOrbitType[level];
  const cacheKey = `orbit-cycle-snapshot:${normalizedAddress}:${level}:${cycleNumber}`;

  return cached(
    cacheKey,
    async () => {
      let snapshot = await OrbitCycleSnapshot.findOne({
        address: normalizedAddress,
        level,
        cycleNumber,
      }).lean();

      const latestActivity = await getLatestIndexedActivityForCycle(
        normalizedAddress,
        level,
        orbitType,
        cycleNumber
      );

      const isMissing = !snapshot;
      const isIncomplete =
        !snapshot?.metadata?.completeness?.positionsReady ||
        !snapshot?.metadata?.completeness?.historicalReady;
      const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
      const isStale = isSnapshotStale(snapshot, CYCLE_SNAPSHOT_TTL_MS);

      if (isMissing) {
        logDebug('[CYCLE_SNAPSHOT_MISSING_REBUILD]', {
          address: normalizedAddress,
          level,
          cycleNumber,
        });

        snapshot = await rebuildCycleSnapshot(
          normalizedAddress,
          level,
          cycleNumber
        );

        if (!snapshot) {
          return {
            address: normalizedAddress,
            level,
            cycleNumber,
            orbitType,
            filledPositions: [],
            totalPositions: getOrbitPositionCount(orbitType),
            positions: [],
            isFallback: true,
          };
        }
      }

      if (isIncomplete || hasNewIndexedActivity || isStale) {
        refreshCycleSnapshotInBackground(
          normalizedAddress,
          level,
          cycleNumber
        );
      }

      return {
        address: normalizedAddress,
        level,
        cycleNumber,
        orbitType: snapshot.orbitType,
        filledPositions: snapshot.filledPositions,
        totalPositions: snapshot.totalPositions,
        positions: snapshot.positions || [],
      };
    },
    10000
  );
}, {
  address: null,
  level: 0,
  cycleNumber: 0,
  orbitType: null,
  filledPositions: [],
  totalPositions: 0,
  positions: [],
  isFallback: true
});


function decimalStringToNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatNumber2(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function sumReceiptMoney(receipts = []) {
  return receipts.reduce(
    (acc, receipt) => {
      acc.totalGeneratedRaw += toBigIntSafe(receipt.grossAmount);
      acc.totalLiquidRaw += toBigIntSafe(receipt.liquidPaid);
      acc.receiptEscrowLockedRaw += toBigIntSafe(receipt.escrowLocked);
      acc.receiptCount += 1;
      return acc;
    },
    {
      totalGeneratedRaw: 0n,
      totalLiquidRaw: 0n,
      receiptEscrowLockedRaw: 0n,
      receiptCount: 0,
    }
  );
}

function groupReceiptMoneyByLevel(receipts = [], escrowByLevel = new Map()) {
  const grouped = new Map();

  for (const receipt of receipts) {
    const level = Number(receipt.level || 0);
    if (!level) continue;

    if (!grouped.has(level)) {
      grouped.set(level, {
        level,
        orbitType: levelToOrbitType[level] || '',
        generatedRaw: 0n,
        liquidRaw: 0n,
        receiptEscrowLockedRaw: 0n,
        receiptCount: 0,
      });
    }

    const item = grouped.get(level);

    item.generatedRaw += toBigIntSafe(receipt.grossAmount);
    item.liquidRaw += toBigIntSafe(receipt.liquidPaid);
    item.receiptEscrowLockedRaw += toBigIntSafe(receipt.escrowLocked);
    item.receiptCount += 1;
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.level - b.level)
    .map((item) => {
      const escrow = escrowByLevel.get(item.level) || {};

      return {
        level: item.level,
        orbitType: item.orbitType,

        generated: formatUsdt(item.generatedRaw),
        liquid: formatUsdt(item.liquidRaw),

        // Backward compatible alias. This previously represented receipt escrow.
        escrowUsed: formatUsdt(escrow.usedForUpgradeRaw ?? 0n),

        escrowLockedLifetime: formatUsdt(
          maxBigInt(
            escrow.lockedLifetimeRaw ?? 0n,
            item.receiptEscrowLockedRaw
          )
        ),
        autoUpgradeUsed: formatUsdt(escrow.usedForUpgradeRaw ?? 0n),
        escrowReleasedToUser: formatUsdt(escrow.releasedToUserRaw ?? 0n),
        currentLocked: formatUsdt(escrow.currentLockedRaw ?? 0n),

        receiptEscrowLocked: formatUsdt(item.receiptEscrowLockedRaw),
        receiptCount: item.receiptCount,
      };
    });
}

async function fetchUserEscrowMetrics(address) {
  const normalizedAddress = normalizeAddress(address);

  const result = {
    lockedLifetimeRaw: 0n,
    usedForUpgradeRaw: 0n,
    releasedToUserRaw: 0n,
    currentLockedRaw: 0n,
    byFromLevel: new Map(),
  };

  let events = [];

  try {
    events = await IndexedEscrowEvent.find({
      user: normalizedAddress,
    })
      .select('eventName fromLevel toLevel amount currentEscrowLockedGlobal blockNumber logIndex timestamp')
      .sort({ blockNumber: 1, logIndex: 1 })
      .lean();
  } catch {
    events = [];
  }

  for (const event of events) {
    const fromLevel = Number(event.fromLevel || 0);
    if (!fromLevel) continue;

    if (!result.byFromLevel.has(fromLevel)) {
      result.byFromLevel.set(fromLevel, {
        level: fromLevel,
        nextLevel: Number(event.toLevel || fromLevel + 1),
        lockedLifetimeRaw: 0n,
        usedForUpgradeRaw: 0n,
        releasedToUserRaw: 0n,
        currentLockedRaw: 0n,
      });
    }

    const item = result.byFromLevel.get(fromLevel);
    const amount = toBigIntSafe(event.amount);

    if (event.eventName === 'EscrowLocked') {
      result.lockedLifetimeRaw += amount;
      item.lockedLifetimeRaw += amount;
      item.currentLockedRaw += amount;
    }

    if (event.eventName === 'EscrowUsedForUpgrade') {
      result.usedForUpgradeRaw += amount;
      item.usedForUpgradeRaw += amount;
      item.currentLockedRaw = item.currentLockedRaw > amount
        ? item.currentLockedRaw - amount
        : 0n;
    }

    if (event.eventName === 'EscrowReleasedToUser') {
      result.releasedToUserRaw += amount;
      item.releasedToUserRaw += amount;
      item.currentLockedRaw = item.currentLockedRaw > amount
        ? item.currentLockedRaw - amount
        : 0n;
    }
  }

  for (const item of result.byFromLevel.values()) {
    result.currentLockedRaw += item.currentLockedRaw;
  }

  return result;
}

async function getCurrentEscrowLockSummary(address, escrowMetrics = null) {
  const normalizedAddress = normalizeAddress(address);
  const contracts = getContracts();

  const snapshots = await OrbitLevelSnapshot.find({
    address: normalizedAddress,
  })
    .select({
      level: 1,
      isLevelActive: 1,
      lockedForNextLevel: 1,
      orbitSummary: 1,
    })
    .lean();

  const activeSnapshots = snapshots
    .filter((snapshot) => snapshot?.isLevelActive)
    .sort((a, b) => Number(a.level || 0) - Number(b.level || 0));

  const activeLevelsFromSnapshots = activeSnapshots.map((snapshot) =>
    Number(snapshot.level || 0)
  );

  let activeLevels = activeLevelsFromSnapshots;

  // Fallback if snapshots are not ready: ask Registration directly.
  if (!activeLevels.length && contracts?.registration?.isLevelActivated) {
    const checks = await Promise.all(
      Array.from({ length: 10 }, (_, index) => index + 1).map(async (level) => {
        const active = await safeOptionalRpc(() =>
          contracts.registration.isLevelActivated(normalizedAddress, level)
        );
        return active ? level : null;
      })
    );

    activeLevels = checks.filter(Boolean);
  }

  const highestLevel = activeLevels.length ? Math.max(...activeLevels) : 0;
  const byLevel = [];

  for (const level of activeLevels) {
    const config = LEVEL_CONFIG[level] || {};
    const nextLevel = config.nextLevel || null;

    let requiredRaw = BigInt(Math.round(Number(config.upgradeReq || 0) * 1_000_000));
    let currentLockedRaw = 0n;
    let remainingRaw = 0n;
    let nextLevelActivated = false;

    // Strongest source: LevelManager getter added in smart contract patch.
    try {
      if (level < 10 && contracts?.levelManager?.getAutoUpgradeStatus) {
        const [requiredAmount, currentLocked, remainingAmount, nextActive] =
          await safeRpcCall(() =>
            contracts.levelManager.getAutoUpgradeStatus(normalizedAddress, level)
          );

        requiredRaw = toBigIntSafe(requiredAmount);
        currentLockedRaw = toBigIntSafe(currentLocked);
        remainingRaw = toBigIntSafe(remainingAmount);
        nextLevelActivated = Boolean(nextActive);
      }
    } catch {
      const escrowLevel = escrowMetrics?.byFromLevel?.get(level);
      const snapshot = activeSnapshots.find((item) => Number(item.level || 0) === level);

      currentLockedRaw = escrowLevel?.currentLockedRaw ??
        toBigIntSafe(
          Math.round(decimalStringToNumber(snapshot?.lockedForNextLevel) * 1_000_000)
        );

      nextLevelActivated = nextLevel
        ? activeLevels.includes(nextLevel)
        : false;

      remainingRaw =
        level >= 10 || !nextLevel || nextLevelActivated || currentLockedRaw >= requiredRaw
          ? 0n
          : requiredRaw - currentLockedRaw;
    }

    // Do not show current/remaining auto-upgrade for a level whose next level is already active.
    const shouldShowAutoUpgrade =
      level < 10 &&
      Boolean(nextLevel) &&
      !nextLevelActivated;

    byLevel.push({
      level,
      orbitType: levelToOrbitType[level] || '',
      nextLevel,
      currentLocked: shouldShowAutoUpgrade ? formatUsdt(currentLockedRaw) : '0.00',
      upgradeRequired: shouldShowAutoUpgrade ? formatUsdt(requiredRaw) : '0.00',
      remainingToNextUpgrade: shouldShowAutoUpgrade ? formatUsdt(remainingRaw) : '0.00',
      nextLevelActivated,
      autoUpgradeCompleted: !shouldShowAutoUpgrade,
      isHighestActiveLevel: level === highestLevel,
      shouldShowAutoUpgrade,
    });
  }

  const highestActiveLock =
    byLevel.find((item) => item.isHighestActiveLevel) || null;

  const currentEscrowLockedRaw = byLevel.reduce((sum, item) => {
    if (!item.shouldShowAutoUpgrade) return sum;
    return sum + BigInt(Math.round(decimalStringToNumber(item.currentLocked) * 1_000_000));
  }, 0n);

  return {
    highestLevel,
    currentEscrowLocked: formatUsdt(currentEscrowLockedRaw),
    remainingToNextUpgrade: highestActiveLock?.remainingToNextUpgrade || '0.00',
    highestActiveLock,
    byLevel,
  };
}

export const fetchUserGlobalSummary = safeApiResponse(async function(address) {
  const normalizedAddress = normalizeAddress(address);

  const [receipts, tokenEvents, escrowMetrics] = await Promise.all([
    IndexedReceipt.find({ receiver: normalizedAddress }).lean(),
    IndexedTokenEvent.find({ userAddress: normalizedAddress })
      .sort({ timestamp: -1 })
      .lean(),
    fetchUserEscrowMetrics(normalizedAddress),
  ]);

  const lockSummary = await getCurrentEscrowLockSummary(
    normalizedAddress,
    escrowMetrics
  );

  const receiptTotals = sumReceiptMoney(receipts);
  const byLevelFinancials = groupReceiptMoneyByLevel(
    receipts,
    escrowMetrics.byFromLevel
  );

  const earningsSummary = summarizeReceiptsForViewer(receipts, normalizedAddress);

  const tokenTotals = tokenEvents.reduce((acc, event) => {
    const amt = BigInt(event.amount || '0');
    const symbol = event.tokenSymbol;

    if (!acc[symbol]) acc[symbol] = { minted: 0n, burned: 0n, locked: 0n };

    if (event.eventName === 'UtilityMinted') acc[symbol].minted += amt;
    if (event.eventName === 'UtilityBurned') acc[symbol].burned += amt;
    if (event.eventName === 'UtilityLocked') acc[symbol].locked += amt;

    return acc;
  }, {});

  const tokens = {};
  for (const sym in tokenTotals) {
    tokens[sym] = {
      total: formatUsdt(tokenTotals[sym].minted),
      burned: formatUsdt(tokenTotals[sym].burned),
      locked: formatUsdt(tokenTotals[sym].locked),
      available: formatUsdt(
        tokenTotals[sym].minted -
          tokenTotals[sym].burned -
          tokenTotals[sym].locked
      ),
    };
  }

  return {
    address: normalizedAddress,

    earnings: {
      ...earningsSummary.viewerBreakdown,

      totalGenerated: formatUsdt(receiptTotals.totalGeneratedRaw),
      totalLiquid: formatUsdt(receiptTotals.totalLiquidRaw),

      // Correct meanings.
      escrowLockedLifetime: formatUsdt(
        maxBigInt(
          escrowMetrics.lockedLifetimeRaw,
          receiptTotals.receiptEscrowLockedRaw
        )
      ),
      autoUpgradeUsed: formatUsdt(escrowMetrics.usedForUpgradeRaw),
      escrowReleasedToUser: formatUsdt(escrowMetrics.releasedToUserRaw),

      // Backward-compatible aliases.
      totalEscrowUsed: formatUsdt(escrowMetrics.usedForUpgradeRaw),
      totalEscrow: formatUsdt(
        maxBigInt(
          escrowMetrics.lockedLifetimeRaw,
          receiptTotals.receiptEscrowLockedRaw
        )
      ),

      receiptEscrowLocked: formatUsdt(receiptTotals.receiptEscrowLockedRaw),
      receiptCount: receiptTotals.receiptCount,

      currentEscrowLocked: lockSummary.currentEscrowLocked,
      remainingToNextUpgrade: lockSummary.remainingToNextUpgrade,
      highestLevel: lockSummary.highestLevel,
      highestActiveLock: lockSummary.highestActiveLock,
      currentLocksByLevel: lockSummary.byLevel,

      byLevel: byLevelFinancials.map((item) => {
        const lock = lockSummary.byLevel.find((entry) => entry.level === item.level);

        return {
          ...item,
          currentLocked: lock?.currentLocked || item.currentLocked || '0.00',
          upgradeRequired:
            lock?.upgradeRequired ||
            formatNumber2(LEVEL_CONFIG[item.level]?.upgradeReq || 0),
          remainingToNextUpgrade: lock?.remainingToNextUpgrade || '0.00',
          autoUpgradeCompleted: Boolean(lock?.autoUpgradeCompleted),
          nextLevelActivated: Boolean(lock?.nextLevelActivated),
          shouldShowAutoUpgrade: Boolean(lock?.shouldShowAutoUpgrade),
        };
      }),
    },

    tokens,

    history: tokenEvents.map((e) => ({
      kind:
        e.eventName === 'UtilityMinted'
          ? e.tokenSymbol === 'FGT'
            ? 'FGT_MINT'
            : 'FGTR_MINT'
          : e.eventName === 'UtilityBurned'
            ? e.tokenSymbol === 'FGT'
              ? 'FGT_BURN'
              : 'FGTR_BURN'
            : 'FGT_LOCK',
      token: e.tokenSymbol,
      amount: e.amount,
      amountFormatted: formatUsdt(e.amount),
      reason: String(e.reason || '').split(':')[0],
      level: e.level,
      txHash: e.txHash,
      timestamp: Math.floor(new Date(e.timestamp).getTime() / 1000),
    })),
  };
}, {});

export const getEarningsPerLevel = async (address) => {
  const normalized = normalizeAddress(address);

  const [receipts, escrowMetrics] = await Promise.all([
    IndexedReceipt.find({ receiver: normalized }).lean(),
    fetchUserEscrowMetrics(normalized),
  ]);

  return groupReceiptMoneyByLevel(receipts, escrowMetrics.byFromLevel).map((item) => ({
    level: item.level,
    orbitType: item.orbitType,

    totalGenerated: item.generated,
    walletCredited: item.liquid,
    escrowLockedLifetime: item.escrowLockedLifetime,
    autoUpgradeUsed: item.autoUpgradeUsed,
    escrowReleasedToUser: item.escrowReleasedToUser,
    currentLocked: item.currentLocked,

    // Backward-compatible names.
    totalEarned: item.liquid,
    totalEscrow: item.escrowLockedLifetime,
    transactionCount: item.receiptCount,
  }));
};












// import { ethers } from 'ethers';
// import { getContracts } from '../../blockchain/contracts.js';
// import { safeRpcCall } from '../../blockchain/provider.js';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import IndexedTokenEvent from '../../models/IndexedTokenEvent.js';
// import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
// import OrbitPositionSnapshot from '../../models/OrbitPositionSnapshot.js';
// import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';
// import { buildOrbitLevelSnapshot } from '../snapshots/orbitLevelSnapshotBuilder.js';
// import { buildOrbitPositionSnapshot } from '../snapshots/orbitPositionSnapshotBuilder.js';
// import { buildOrbitCycleSnapshot } from '../snapshots/orbitCycleSnapshotBuilder.js';
// import { enrichOrbitLevelSnapshot } from '../snapshots/orbitLevelSnapshotEnricher.js';

// import env from '../../config/env.js';

// const RECEIPT_TYPES = {
//   FOUNDER_PATH: 1,
//   DIRECT_OWNER: 2,
//   ROUTED_SPILLOVER: 3,
//   RECYCLE: 4,
// };

// const levelToOrbitType = {
//   1: 'P4',
//   2: 'P12',
//   3: 'P39',
//   4: 'P4',
//   5: 'P12',
//   6: 'P39',
//   7: 'P4',
//   8: 'P12',
//   9: 'P39',
//   10: 'P4',
// };



// const LEVEL_CONFIG = {
//   1: { price: 10, upgradeReq: 20, nextLevel: 2 },
//   2: { price: 20, upgradeReq: 40, nextLevel: 3 },
//   3: { price: 40, upgradeReq: 80, nextLevel: 4 },
//   4: { price: 80, upgradeReq: 160, nextLevel: 5 },
//   5: { price: 160, upgradeReq: 320, nextLevel: 6 },
//   6: { price: 320, upgradeReq: 640, nextLevel: 7 },
//   7: { price: 640, upgradeReq: 1280, nextLevel: 8 },
//   8: { price: 1280, upgradeReq: 2560, nextLevel: 9 },
//   9: { price: 2560, upgradeReq: 5120, nextLevel: 10 },
//   10: { price: 5120, upgradeReq: 0, nextLevel: null },
// };

// const orbitTypeToContractKey = {
//   P4: 'p4Orbit',
//   P12: 'p12Orbit',
//   P39: 'p39Orbit',
// };

// const RESPONSE_CACHE_TTL_MS = Number(env.API_CACHE_TTL_MS) || 15000;
// const LEVEL_SNAPSHOT_TTL_MS = 15000;
// const POSITION_SNAPSHOT_TTL_MS = 15000;
// const CYCLE_SNAPSHOT_TTL_MS = 30000;
// const CACHE_MAX_ENTRIES = 1000;
// const CYCLE_WARM_BATCH_SIZE = 3;
// const LEVELS_FETCH_CONCURRENCY = 3;

// const inflightCache = new Map();
// const responseCache = new Map();

// const backgroundLevelRefreshes = new Map();
// const backgroundPositionRefreshes = new Map();
// const backgroundCycleRefreshes = new Map();
// const backgroundCycleWarmups = new Map();

// function safeApiResponse(fn, fallback) {
//   return async (...args) => {
//     try {
//       return await fn(...args);
//     } catch (error) {
//       console.error('[API_FAILSAFE]', error);
//       return fallback;
//     }
//   };
// }

// async function safeOptionalRpc(fn, fallback = null) {
//   try {
//     return await fn();
//   } catch {
//     return fallback;
//   }
// }

// function isDebugLoggingEnabled() {
//   return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
// }

// function logDebug(...args) {
//   if (isDebugLoggingEnabled()) {
//     console.log(...args);
//   }
// }

// function pruneResponseCacheIfNeeded() {
//   if (responseCache.size <= CACHE_MAX_ENTRIES) return;

//   const oldestKey = responseCache.keys().next().value;
//   if (oldestKey !== undefined) {
//     responseCache.delete(oldestKey);
//   }
// }

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

//   pruneResponseCacheIfNeeded();
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

// function isSnapshotStale(snapshot, ttlMs) {
//   if (!snapshot) return true;

//   const builtAt =
//     snapshot?.metadata?.enrichedAt ||
//     snapshot?.metadata?.builtAt ||
//     snapshot?.updatedAt ||
//     null;

//   if (!builtAt) return true;

//   const builtMs = new Date(builtAt).getTime();
//   if (!Number.isFinite(builtMs)) return true;

//   return Date.now() - builtMs > ttlMs;
// }

// function getSnapshotFreshnessBlock(snapshot) {
//   return Number(
//     snapshot?.metadata?.freshnessBlock ||
//       snapshot?.metadata?.builtFromBlock ||
//       0
//   );
// }

// function getSnapshotBuiltAtMs(snapshot) {
//   const builtAt =
//     snapshot?.metadata?.enrichedAt ||
//     snapshot?.metadata?.builtAt ||
//     snapshot?.updatedAt ||
//     null;

//   if (!builtAt) return 0;

//   const builtMs = new Date(builtAt).getTime();
//   return Number.isFinite(builtMs) ? builtMs : 0;
// }

// async function rebuildAndEnrichLevelSnapshot(address, level) {
//   await buildOrbitLevelSnapshot(address, level);
//   await enrichOrbitLevelSnapshot(address, level);

//   return OrbitLevelSnapshot.findOne({
//     address,
//     level,
//   }).lean();
// }

// async function rebuildPositionSnapshot(address, level, position) {
//   await buildOrbitPositionSnapshot(address, level, position);

//   return OrbitPositionSnapshot.findOne({
//     address,
//     level,
//     position,
//   }).lean();
// }

// async function rebuildCycleSnapshot(address, level, cycleNumber) {
//   await buildOrbitCycleSnapshot(address, level, cycleNumber);

//   return OrbitCycleSnapshot.findOne({
//     address,
//     level,
//     cycleNumber,
//   }).lean();
// }

// function scheduleBackgroundJob(jobMap, key, handler) {
//   if (jobMap.has(key)) {
//     return jobMap.get(key);
//   }

//   const job = (async () => {
//     try {
//       await handler();
//     } catch (error) {
//       console.error(`[BACKGROUND_JOB_FAILED] ${key}`, error);
//     } finally {
//       jobMap.delete(key);
//     }
//   })();

//   jobMap.set(key, job);
//   return job;
// }

// function refreshLevelSnapshotInBackground(address, level) {
//   const key = `${address}:${level}`;

//   return scheduleBackgroundJob(backgroundLevelRefreshes, key, async () => {
//     logDebug('[LEVEL_REFRESH_BG_START]', { address, level });
//     await rebuildAndEnrichLevelSnapshot(address, level);
//     responseCache.delete(`orbit-level-snapshot:${address}:${level}`);
//     logDebug('[LEVEL_REFRESH_BG_DONE]', { address, level });
//   });
// }

// function refreshPositionSnapshotInBackground(address, level, position) {
//   const key = `${address}:${level}:${position}`;

//   return scheduleBackgroundJob(backgroundPositionRefreshes, key, async () => {
//     logDebug('[POSITION_REFRESH_BG_START]', { address, level, position });
//     await rebuildPositionSnapshot(address, level, position);
//     responseCache.delete(`orbit-position-details:${address}:${level}:${position}`);
//     logDebug('[POSITION_REFRESH_BG_DONE]', { address, level, position });
//   });
// }

// function refreshCycleSnapshotInBackground(address, level, cycleNumber) {
//   const key = `${address}:${level}:${cycleNumber}`;

//   return scheduleBackgroundJob(backgroundCycleRefreshes, key, async () => {
//     logDebug('[CYCLE_REFRESH_BG_START]', { address, level, cycleNumber });
//     await rebuildCycleSnapshot(address, level, cycleNumber);
//     responseCache.delete(`orbit-cycle-snapshot:${address}:${level}:${cycleNumber}`);
//     logDebug('[CYCLE_REFRESH_BG_DONE]', { address, level, cycleNumber });
//   });
// }

// function warmCycleSnapshotsInBackground(address, level, totalCycles) {
//   const cycleCount = Number(totalCycles || 0);
//   if (cycleCount <= 0) return;

//   const warmKey = `${address}:${level}:${cycleCount}`;

//   scheduleBackgroundJob(backgroundCycleWarmups, warmKey, async () => {
//     const cycleNumbers = Array.from({ length: cycleCount }, (_, i) => i + 1);

//     for (let i = 0; i < cycleNumbers.length; i += CYCLE_WARM_BATCH_SIZE) {
//       const batch = cycleNumbers.slice(i, i + CYCLE_WARM_BATCH_SIZE);

//       await Promise.all(
//         batch.map(async (cycleNumber) => {
//           const existing = await OrbitCycleSnapshot.findOne({
//             address,
//             level,
//             cycleNumber,
//           })
//             .select({ updatedAt: 1, metadata: 1 })
//             .lean();

//           if (!isSnapshotStale(existing, CYCLE_SNAPSHOT_TTL_MS)) {
//             return;
//           }

//           try {
//             await buildOrbitCycleSnapshot(address, level, cycleNumber);
//             responseCache.delete(`orbit-cycle-snapshot:${address}:${level}:${cycleNumber}`);
//           } catch (error) {
//             console.error(
//               `[CYCLE_WARM_FAILED] address=${address} level=${level} cycle=${cycleNumber}`,
//               error
//             );
//           }
//         })
//       );
//     }

//     logDebug('[CYCLE_WARM_DONE]', { address, level, totalCycles: cycleCount });
//   });
// }

// async function mapWithConcurrency(items, limit, mapper) {
//   const results = new Array(items.length);
//   let nextIndex = 0;

//   async function worker() {
//     while (true) {
//       const current = nextIndex;
//       nextIndex += 1;
//       if (current >= items.length) break;
//       results[current] = await mapper(items[current], current);
//     }
//   }

//   const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
//   await Promise.all(workers);
//   return results;
// }

// function normalizeAddress(address) {
//   if (!ethers.isAddress(address)) {
//     const error = new Error('Invalid wallet address');
//     error.status = 400;
//     throw error;
//   }

//   return address.toLowerCase();
// }

// function validateLevel(level) {
//   if (!Number.isInteger(level) || level < 1 || level > 10) {
//     const error = new Error('Invalid level');
//     error.status = 400;
//     throw error;
//   }
// }

// function validateCycleNumber(cycleNumber) {
//   if (!Number.isInteger(cycleNumber) || cycleNumber < 1) {
//     const error = new Error('Invalid cycle number');
//     error.status = 400;
//     throw error;
//   }
// }

// function validatePosition(position, max) {
//   if (!Number.isInteger(position) || position < 1 || position > max) {
//     const error = new Error('Invalid position');
//     error.status = 400;
//     throw error;
//   }
// }

// function formatUsdt(value) {
//   try {
//     return ethers.formatUnits(value ?? 0, 6);
//   } catch {
//     return '0.0';
//   }
// }

// function addBigIntStrings(a, b) {
//   return (BigInt(a || '0') + BigInt(b || '0')).toString();
// }

// function buildEmptyReceiptTotals() {
//   return {
//     count: 0,
//     gross: '0',
//     escrowLocked: '0',
//     liquidPaid: '0',
//     founderPathGross: '0',
//     directOwnerGross: '0',
//     routedSpilloverGross: '0',
//     recycleGross: '0',
//   };
// }

// function buildEmptyViewerBreakdown() {
//   return {
//     count: 0,
//     totalGross: '0',
//     totalLiquid: '0',
//     totalEscrow: '0',
//     founderPathGross: '0',
//     founderPathLiquid: '0',
//     founderPathEscrow: '0',
//     directOwnerGross: '0',
//     directOwnerLiquid: '0',
//     directOwnerEscrow: '0',
//     routedSpilloverGross: '0',
//     routedSpilloverLiquid: '0',
//     routedSpilloverEscrow: '0',
//     recycleGross: '0',
//     recycleLiquid: '0',
//     recycleEscrow: '0',
//   };
// }

// function getOrbitPositionCount(orbitType) {
//   if (orbitType === 'P4') return 4;
//   if (orbitType === 'P12') return 12;
//   return 39;
// }

// function getLineForPosition(orbitType, position) {
//   if (orbitType === 'P4') return 1;
//   if (orbitType === 'P12') return position <= 3 ? 1 : 2;
//   if (orbitType === 'P39') {
//     if (position <= 3) return 1;
//     if (position <= 12) return 2;
//     return 3;
//   }
//   return 1;
// }

// function getStructuralParentPosition(orbitType, position) {
//   if (orbitType === 'P4') return null;

//   if (orbitType === 'P12') {
//     if ([4, 7, 10].includes(position)) return 1;
//     if ([5, 8, 11].includes(position)) return 2;
//     if ([6, 9, 12].includes(position)) return 3;
//     return null;
//   }

//   if (orbitType === 'P39') {
//     if ([4, 7, 10].includes(position)) return 1;
//     if ([5, 8, 11].includes(position)) return 2;
//     if ([6, 9, 12].includes(position)) return 3;
//     if ([13, 22, 31].includes(position)) return 4;
//     if ([14, 23, 32].includes(position)) return 5;
//     if ([15, 24, 33].includes(position)) return 6;
//     if ([16, 25, 34].includes(position)) return 7;
//     if ([17, 26, 35].includes(position)) return 8;
//     if ([18, 27, 36].includes(position)) return 9;
//     if ([19, 28, 37].includes(position)) return 10;
//     if ([20, 29, 38].includes(position)) return 11;
//     if ([21, 30, 39].includes(position)) return 12;
//     return null;
//   }

//   return null;
// }

// function getTruthLabelFromReceipts(receipts) {
//   if (!receipts || receipts.length === 0) return 'NO_RECEIPT';

//   const types = new Set(receipts.map((r) => Number(r.receiptType || 0)));

//   if (types.has(RECEIPT_TYPES.FOUNDER_PATH)) return 'FOUNDER_PATH';
//   if (
//     types.has(RECEIPT_TYPES.DIRECT_OWNER) &&
//     types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)
//   ) {
//     return 'DIRECT_AND_ROUTED';
//   }
//   if (types.has(RECEIPT_TYPES.DIRECT_OWNER)) return 'DIRECT_OWNER';
//   if (types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)) return 'ROUTED_SPILLOVER';
//   if (types.has(RECEIPT_TYPES.RECYCLE)) return 'RECYCLE';

//   return 'UNKNOWN';
// }

// function normalizeRuleView(ruleResult) {
//   if (!ruleResult) return null;

//   const isHistorical =
//     ruleResult.hasStoredRuleData !== undefined ||
//     (Array.isArray(ruleResult) && ruleResult.length >= 13);

//   if (isHistorical) {
//     return {
//       cycleNumber: Number(ruleResult.cycleNumber ?? ruleResult[0] ?? 0),
//       position: Number(ruleResult.position ?? ruleResult[1] ?? 0),
//       line: Number(ruleResult.line ?? ruleResult[2] ?? 0),
//       linePaymentNumber: Number(
//         ruleResult.linePaymentNumber ?? ruleResult[3] ?? 0
//       ),
//       autoUpgradeEnabled: Boolean(
//         ruleResult.autoUpgradeEnabled ?? ruleResult[4] ?? false
//       ),
//       hasStoredRuleData: Boolean(
//         ruleResult.hasStoredRuleData ?? ruleResult[5] ?? false
//       ),
//       isFounderNoReferrerPath: false,
//       toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[6] ?? 0),
//       toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[7] ?? 0),
//       toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[8] ?? 0),
//       toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[9] ?? 0),
//       toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[10] ?? 0),
//       spillover1Recipient:
//         ruleResult.spillover1Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
//       spillover2Recipient:
//         ruleResult.spillover2Recipient ?? ruleResult[12] ?? ethers.ZeroAddress,
//     };
//   }

//   return {
//     position: Number(ruleResult.position ?? ruleResult[0] ?? 0),
//     line: Number(ruleResult.line ?? ruleResult[1] ?? 0),
//     linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[2] ?? 0),
//     autoUpgradeEnabled: Boolean(
//       ruleResult.autoUpgradeEnabled ?? ruleResult[3] ?? false
//     ),
//     isFounderNoReferrerPath: Boolean(
//       ruleResult.isFounderNoReferrerPath ?? ruleResult[4] ?? false
//     ),
//     hasStoredRuleData: false,
//     toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[5] ?? 0),
//     toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[6] ?? 0),
//     toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[7] ?? 0),
//     toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[8] ?? 0),
//     toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[9] ?? 0),
//     spillover1Recipient:
//       ruleResult.spillover1Recipient ?? ruleResult[10] ?? ethers.ZeroAddress,
//     spillover2Recipient:
//       ruleResult.spillover2Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
//   };
// }

// async function getOrbitContext(level) {
//   validateLevel(level);

//   const orbitType = levelToOrbitType[level];
//   const contractKey = orbitTypeToContractKey[orbitType];
//   const contracts = getContracts();

//   if (!orbitType || !contractKey || !contracts[contractKey]) {
//     const error = new Error(`Unsupported level: ${level}`);
//     error.status = 400;
//     throw error;
//   }

//   return {
//     contracts,
//     orbitType,
//     orbitContract: contracts[contractKey],
//     positionsCount: getOrbitPositionCount(orbitType),
//   };
// }

// async function tryCall(contract, methodNames, args) {
//   for (const methodName of methodNames) {
//     if (typeof contract?.[methodName] === 'function') {
//       try {
//         const result = await safeOptionalRpc(() => contract[methodName](...args));
//         return { ok: true, methodName, result };
//       } catch {
//         // continue
//       }
//     }
//   }

//   return { ok: false, methodName: null, result: null };
// }

// function summarizeReceiptsForViewer(receipts, viewedAddress) {
//   const totals = buildEmptyReceiptTotals();
//   const viewer = buildEmptyViewerBreakdown();
//   const lowerViewed = viewedAddress.toLowerCase();

//   for (const receipt of receipts) {
//     totals.count += 1;
//     totals.gross = addBigIntStrings(totals.gross, receipt.grossAmount);
//     totals.escrowLocked = addBigIntStrings(
//       totals.escrowLocked,
//       receipt.escrowLocked
//     );
//     totals.liquidPaid = addBigIntStrings(totals.liquidPaid, receipt.liquidPaid);

//     const type = Number(receipt.receiptType || 0);

//     if (type === RECEIPT_TYPES.FOUNDER_PATH) {
//       totals.founderPathGross = addBigIntStrings(
//         totals.founderPathGross,
//         receipt.grossAmount
//       );
//     } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
//       totals.directOwnerGross = addBigIntStrings(
//         totals.directOwnerGross,
//         receipt.grossAmount
//       );
//     } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
//       totals.routedSpilloverGross = addBigIntStrings(
//         totals.routedSpilloverGross,
//         receipt.grossAmount
//       );
//     } else if (type === RECEIPT_TYPES.RECYCLE) {
//       totals.recycleGross = addBigIntStrings(
//         totals.recycleGross,
//         receipt.grossAmount
//       );
//     }

//     if ((receipt.receiver || '').toLowerCase() !== lowerViewed) continue;

//     viewer.count += 1;
//     viewer.totalGross = addBigIntStrings(viewer.totalGross, receipt.grossAmount);
//     viewer.totalLiquid = addBigIntStrings(
//       viewer.totalLiquid,
//       receipt.liquidPaid
//     );
//     viewer.totalEscrow = addBigIntStrings(
//       viewer.totalEscrow,
//       receipt.escrowLocked
//     );

//     if (type === RECEIPT_TYPES.FOUNDER_PATH) {
//       viewer.founderPathGross = addBigIntStrings(
//         viewer.founderPathGross,
//         receipt.grossAmount
//       );
//       viewer.founderPathLiquid = addBigIntStrings(
//         viewer.founderPathLiquid,
//         receipt.liquidPaid
//       );
//       viewer.founderPathEscrow = addBigIntStrings(
//         viewer.founderPathEscrow,
//         receipt.escrowLocked
//       );
//     } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
//       viewer.directOwnerGross = addBigIntStrings(
//         viewer.directOwnerGross,
//         receipt.grossAmount
//       );
//       viewer.directOwnerLiquid = addBigIntStrings(
//         viewer.directOwnerLiquid,
//         receipt.liquidPaid
//       );
//       viewer.directOwnerEscrow = addBigIntStrings(
//         viewer.directOwnerEscrow,
//         receipt.escrowLocked
//       );
//     } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
//       viewer.routedSpilloverGross = addBigIntStrings(
//         viewer.routedSpilloverGross,
//         receipt.grossAmount
//       );
//       viewer.routedSpilloverLiquid = addBigIntStrings(
//         viewer.routedSpilloverLiquid,
//         receipt.liquidPaid
//       );
//       viewer.routedSpilloverEscrow = addBigIntStrings(
//         viewer.routedSpilloverEscrow,
//         receipt.escrowLocked
//       );
//     } else if (type === RECEIPT_TYPES.RECYCLE) {
//       viewer.recycleGross = addBigIntStrings(
//         viewer.recycleGross,
//         receipt.grossAmount
//       );
//       viewer.recycleLiquid = addBigIntStrings(
//         viewer.recycleLiquid,
//         receipt.liquidPaid
//       );
//       viewer.recycleEscrow = addBigIntStrings(
//         viewer.recycleEscrow,
//         receipt.escrowLocked
//       );
//     }
//   }

//   return {
//     totals: {
//       count: totals.count,
//       gross: formatUsdt(totals.gross),
//       escrowLocked: formatUsdt(totals.escrowLocked),
//       liquidPaid: formatUsdt(totals.liquidPaid),
//       founderPathGross: formatUsdt(totals.founderPathGross),
//       directOwnerGross: formatUsdt(totals.directOwnerGross),
//       routedSpilloverGross: formatUsdt(totals.routedSpilloverGross),
//       recycleGross: formatUsdt(totals.recycleGross),
//     },
//     viewerBreakdown: {
//       count: viewer.count,
//       totalGross: formatUsdt(viewer.totalGross),
//       totalLiquid: formatUsdt(viewer.totalLiquid),
//       totalEscrow: formatUsdt(viewer.totalEscrow),
//       founderPathGross: formatUsdt(viewer.founderPathGross),
//       founderPathLiquid: formatUsdt(viewer.founderPathLiquid),
//       founderPathEscrow: formatUsdt(viewer.founderPathEscrow),
//       directOwnerGross: formatUsdt(viewer.directOwnerGross),
//       directOwnerLiquid: formatUsdt(viewer.directOwnerLiquid),
//       directOwnerEscrow: formatUsdt(viewer.directOwnerEscrow),
//       routedSpilloverGross: formatUsdt(viewer.routedSpilloverGross),
//       routedSpilloverLiquid: formatUsdt(viewer.routedSpilloverLiquid),
//       routedSpilloverEscrow: formatUsdt(viewer.routedSpilloverEscrow),
//       recycleGross: formatUsdt(viewer.recycleGross),
//       recycleLiquid: formatUsdt(viewer.recycleLiquid),
//       recycleEscrow: formatUsdt(viewer.recycleEscrow),
//     },
//     truthLabel: getTruthLabelFromReceipts(receipts),
//   };
// }

// async function fetchIndexedReceiptsForActivation(activationId) {
//   if (!activationId || Number(activationId) <= 0) return [];

//   return IndexedReceipt.find({
//     activationId: String(activationId),
//   })
//     .sort({ blockNumber: 1, logIndex: 1 })
//     .lean();
// }

// async function fetchLiveRuleView(orbitContract, address, level, position) {
//   const call = await tryCall(
//     orbitContract,
//     ['getPositionRuleView'],
//     [address, level, position]
//   );

//   return call.ok ? normalizeRuleView(call.result) : null;
// }

// async function fetchHistoricalRuleView(
//   orbitContract,
//   address,
//   level,
//   cycleNumber,
//   position
// ) {
//   const call = await tryCall(
//     orbitContract,
//     ['getHistoricalPositionRuleView'],
//     [address, level, cycleNumber, position]
//   );

//   return call.ok ? normalizeRuleView(call.result) : null;
// }

// async function fetchLiveActivationData(orbitContract, address, level, position) {
//   if (typeof orbitContract.getPositionActivationData !== 'function') {
//     return {
//       activationId: 0,
//       activationCycleNumber: 0,
//       isMirrorActivation: false,
//     };
//   }

//   const result = await safeOptionalRpc(() =>
//     orbitContract.getPositionActivationData(address, level, position)
//   );

//   if (!result) {
//     return {
//       activationId: 0,
//       activationCycleNumber: 0,
//       isMirrorActivation: false,
//     };
//   }

//   return {
//     activationId: Number(result?.activationId ?? result?.[0] ?? 0),
//     activationCycleNumber: Number(result?.cycleNumber ?? result?.[1] ?? 0),
//     isMirrorActivation: Boolean(result?.isMirror ?? result?.[2] ?? false),
//   };
// }

// async function fetchHistoricalActivationData(
//   orbitContract,
//   address,
//   level,
//   cycleNumber,
//   position
// ) {
//   if (typeof orbitContract.getHistoricalPositionActivationData !== 'function') {
//     return {
//       activationId: 0,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//     };
//   }

//   const result = await safeOptionalRpc(() =>
//     orbitContract.getHistoricalPositionActivationData(
//       address,
//       level,
//       cycleNumber,
//       position
//     )
//   );

//   if (!result) {
//     return {
//       activationId: 0,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//     };
//   }

//   return {
//     activationId: Number(result?.activationId ?? result?.[0] ?? 0),
//     activationCycleNumber: cycleNumber,
//     isMirrorActivation: Boolean(result?.isMirror ?? result?.[1] ?? false),
//   };
// }

// function shapeIndexedReceipts(receipts) {
//   return receipts.map((receipt) => ({
//     txHash: receipt.txHash,
//     logIndex: receipt.logIndex,
//     blockNumber: receipt.blockNumber,
//     receiver: receipt.receiver,
//     activationId: receipt.activationId,
//     receiptType: receipt.receiptType,
//     level: receipt.level,
//     fromUser: receipt.fromUser,
//     orbitOwner: receipt.orbitOwner,
//     sourcePosition: receipt.sourcePosition,
//     sourceCycle: receipt.sourceCycle,
//     mirroredPosition: receipt.mirroredPosition,
//     mirroredCycle: receipt.mirroredCycle,
//     routedRole: receipt.routedRole,
//     grossAmount: formatUsdt(receipt.grossAmount),
//     escrowLocked: formatUsdt(receipt.escrowLocked),
//     liquidPaid: formatUsdt(receipt.liquidPaid),
//     timestamp: receipt.timestamp,
//     rawEventName: receipt.rawEventName,
//   }));
// }

// // FIX 4: Safest findBestIndexedPositionFilledEvent
// function findBestIndexedPositionFilledEvent(indexedEvents = []) {
//   const sorted = [...indexedEvents].sort(
//     (a, b) =>
//       Number(a.blockNumber || 0) - Number(b.blockNumber || 0) ||
//       Number(a.logIndex || 0) - Number(b.logIndex || 0)
//   );

//   return sorted.length > 0 ? sorted[sorted.length - 1] : null;
// }

// function findActivationIdFromIndexedReceipts(
//   receipts = [],
//   cycleNumber,
//   positionNumber
// ) {
//   const match = receipts.find(
//     (receipt) =>
//       Number(receipt.sourceCycle || 0) === Number(cycleNumber) &&
//       Number(receipt.sourcePosition || 0) === Number(positionNumber) &&
//       Number(receipt.activationId || 0) > 0
//   );

//   return match ? Number(match.activationId) : 0;
// }

// async function fetchIndexedReceiptsForHistoricalPosition(
//   orbitOwner,
//   level,
//   cycleNumber,
//   positionNumber
// ) {
//   return IndexedReceipt.find({
//     orbitOwner: orbitOwner.toLowerCase(),
//     level,
//     sourceCycle: Number(cycleNumber),
//     sourcePosition: Number(positionNumber),
//   })
//     .sort({ blockNumber: 1, logIndex: 1 })
//     .lean();
// }

// // FIX 1: Replace unsafe grouped event function
// async function getIndexedOrbitEventsForLevel(orbitOwner, level, orbitType) {
//   return IndexedOrbitEvent.find({
//     orbitOwner: orbitOwner.toLowerCase(),
//     level,
//     orbitType,
//   })
//     .sort({ blockNumber: 1, logIndex: 1 })
//     .lean();
// }

// async function getLatestIndexedActivityForLevel(address, level, orbitType) {
//   const [latestEvent, latestReceipt] = await Promise.all([
//     IndexedOrbitEvent.findOne({
//       orbitOwner: address,
//       level,
//       orbitType,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),

//     IndexedReceipt.findOne({
//       orbitOwner: address,
//       level,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),
//   ]);

//   const latestBlock = Math.max(
//     Number(latestEvent?.blockNumber || 0),
//     Number(latestReceipt?.blockNumber || 0)
//   );

//   const latestUpdatedAtMs = Math.max(
//     new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
//     new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
//   );

//   return {
//     latestBlock,
//     latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
//   };
// }

// async function getLatestIndexedActivityForPosition(address, level, orbitType, position) {
//   const [latestEvent, latestReceipt] = await Promise.all([
//     IndexedOrbitEvent.findOne({
//       orbitOwner: address,
//       level,
//       orbitType,
//       position,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),

//     IndexedReceipt.findOne({
//       orbitOwner: address,
//       level,
//       sourcePosition: position,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),
//   ]);

//   const latestBlock = Math.max(
//     Number(latestEvent?.blockNumber || 0),
//     Number(latestReceipt?.blockNumber || 0)
//   );

//   const latestUpdatedAtMs = Math.max(
//     new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
//     new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
//   );

//   return {
//     latestBlock,
//     latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
//   };
// }

// async function getLatestIndexedActivityForCycle(address, level, orbitType, cycleNumber) {
//   const [latestEvent, latestReceipt] = await Promise.all([
//     IndexedOrbitEvent.findOne({
//       orbitOwner: address,
//       level,
//       orbitType,
//       cycleNumber,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),

//     IndexedReceipt.findOne({
//       orbitOwner: address,
//       level,
//       sourceCycle: cycleNumber,
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .select({ blockNumber: 1, updatedAt: 1, createdAt: 1 })
//       .lean(),
//   ]);

//   const latestBlock = Math.max(
//     Number(latestEvent?.blockNumber || 0),
//     Number(latestReceipt?.blockNumber || 0)
//   );

//   const latestUpdatedAtMs = Math.max(
//     new Date(latestEvent?.updatedAt || latestEvent?.createdAt || 0).getTime() || 0,
//     new Date(latestReceipt?.updatedAt || latestReceipt?.createdAt || 0).getTime() || 0
//   );

//   return {
//     latestBlock,
//     latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0,
//   };
// }

// function hasIndexedActivityAdvanced(snapshot, latestActivity) {
//   if (!snapshot) return true;
//   if (!latestActivity) return false;

//   const snapshotFreshnessBlock = getSnapshotFreshnessBlock(snapshot);
//   const snapshotBuiltAtMs = getSnapshotBuiltAtMs(snapshot);

//   if (Number(latestActivity.latestBlock || 0) > snapshotFreshnessBlock) {
//     return true;
//   }

//   if (
//     Number(latestActivity.latestUpdatedAtMs || 0) > 0 &&
//     Number(latestActivity.latestUpdatedAtMs || 0) > snapshotBuiltAtMs
//   ) {
//     return true;
//   }

//   return false;
// }

// async function buildLivePositionSnapshot(address, level, positionNumber, preloaded = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   const { orbitType, orbitContract } = await getOrbitContext(level);

//   const [position, activationData, ruleView] = await Promise.all([
//     safeOptionalRpc(() =>
//       orbitContract.getPosition(normalizedAddress, level, positionNumber)
//     ),
//     fetchLiveActivationData(orbitContract, normalizedAddress, level, positionNumber),
//     fetchLiveRuleView(orbitContract, normalizedAddress, level, positionNumber),
//   ]);

//   // FIX 2: Live position event filtering
//   const indexedEvents = (preloaded.allIndexedEvents || []).filter(
//     (event) =>
//       event.eventName === 'PositionFilled' &&
//       Number(event.position || 0) === Number(positionNumber)
//   );
  
//   const occupant =
//     position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
//   const indexedReceipts = await fetchIndexedReceiptsForActivation(
//     activationData.activationId
//   );
//   const receiptSummary = summarizeReceiptsForViewer(
//     indexedReceipts,
//     normalizedAddress
//   );

//   return {
//     number: positionNumber,
//     level,
//     orbitType,
//     line: getLineForPosition(orbitType, positionNumber),
//     parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//     occupant,
//     amount: occupant ? formatUsdt(position?.[1]) : '0.0',
//     timestamp: Number(position?.[2] ?? 0),
//     activationId: activationData.activationId,
//     activationCycleNumber: activationData.activationCycleNumber,
//     isMirrorActivation: activationData.isMirrorActivation,
//     truthLabel: receiptSummary.truthLabel,
//     indexedEventCount: indexedEvents.length,
//     indexedReceiptCount: indexedReceipts.length,
//     receiptTotals: receiptSummary.totals,
//     viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
//     indexedReceipts: shapeIndexedReceipts(indexedReceipts),
//     indexedEvents,
//     ruleView,
//   };
// }

// async function buildHistoricalPositionSnapshot(
//   address,
//   level,
//   cycleNumber,
//   positionNumber,
//   preloaded = {}
// ) {
//   const normalizedAddress = normalizeAddress(address);
//   const { orbitType, orbitContract } = await getOrbitContext(level);

//   // FIX 3: Historical position event filtering
//   const indexedEvents = (preloaded.allIndexedEvents || []).filter(
//     (event) =>
//       event.eventName === 'PositionFilled' &&
//       Number(event.position || 0) === Number(positionNumber) &&
//       Number(event.cycleNumber || 0) === Number(cycleNumber)
//   );

//   const indexedReceiptsForPosition =
//     await fetchIndexedReceiptsForHistoricalPosition(
//       normalizedAddress,
//       level,
//       cycleNumber,
//       positionNumber
//     );

//   const historicalPositionCall = await tryCall(
//     orbitContract,
//     ['getHistoricalPosition', 'getCyclePosition', 'getStoredCyclePosition', 'getArchivedPosition'],
//     [normalizedAddress, level, cycleNumber, positionNumber]
//   );

//   if (!historicalPositionCall.ok) {
//     const error = new Error(
//       'Historical position getter not supported by this orbit contract'
//     );
//     error.status = 400;
//     throw error;
//   }

//   const position = historicalPositionCall.result || [];
//   let occupant =
//     position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
//   let amount = occupant ? formatUsdt(position?.[1]) : '0.0';
//   let timestamp = Number(position?.[2] ?? 0);

//   const [activationDataRaw, ruleView] = await Promise.all([
//     fetchHistoricalActivationData(
//       orbitContract,
//       normalizedAddress,
//       level,
//       cycleNumber,
//       positionNumber
//     ),
//     fetchHistoricalRuleView(
//       orbitContract,
//       normalizedAddress,
//       level,
//       cycleNumber,
//       positionNumber
//     ),
//   ]);

//   let activationId = Number(activationDataRaw.activationId || 0);
//   let activationCycleNumber = Number(
//     activationDataRaw.activationCycleNumber || cycleNumber
//   );
//   let isMirrorActivation = Boolean(activationDataRaw.isMirrorActivation || false);

//   const bestIndexedPositionFilled = findBestIndexedPositionFilledEvent(indexedEvents);

//   if (!occupant && bestIndexedPositionFilled) {
//     occupant = bestIndexedPositionFilled.user || null;

//     if (bestIndexedPositionFilled.amount) {
//       amount = formatUsdt(bestIndexedPositionFilled.amount);
//     }

//     if (bestIndexedPositionFilled.timestamp) {
//       timestamp = Math.floor(
//         new Date(bestIndexedPositionFilled.timestamp).getTime() / 1000
//       );
//     }
//   }

//   if (!activationId && indexedReceiptsForPosition.length > 0) {
//     activationId = findActivationIdFromIndexedReceipts(
//       indexedReceiptsForPosition,
//       cycleNumber,
//       positionNumber
//     );
//   }

//   const indexedReceipts =
//     activationId > 0
//       ? await fetchIndexedReceiptsForActivation(activationId)
//       : indexedReceiptsForPosition;

//   const receiptSummary = summarizeReceiptsForViewer(
//     indexedReceipts,
//     normalizedAddress
//   );

//   let truthLabel = receiptSummary.truthLabel;
//   if (truthLabel === 'NO_RECEIPT' && bestIndexedPositionFilled && occupant) {
//     truthLabel = 'UNKNOWN';
//   }

//   return {
//     number: positionNumber,
//     level,
//     cycleNumber,
//     orbitType,
//     line: getLineForPosition(orbitType, positionNumber),
//     parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//     occupant,
//     amount,
//     timestamp,
//     activationId,
//     activationCycleNumber,
//     isMirrorActivation,
//     truthLabel,
//     indexedEventCount: indexedEvents.length,
//     indexedReceiptCount: indexedReceipts.length,
//     receiptTotals: {
//       ...receiptSummary.totals,
//     },
//     viewerReceiptBreakdown: {
//       ...receiptSummary.viewerBreakdown,
//     },
//     indexedReceipts: shapeIndexedReceipts(indexedReceipts),
//     indexedEvents,
//     ruleView,
//   };
// }

// export const fetchOrbitLevels = safeApiResponse(async function fetchOrbitLevels(address) {
//   const normalizedAddress = normalizeAddress(address);
//   const cacheKey = `orbit-levels:${normalizedAddress}`;

//   return cached(
//     cacheKey,
//     async () => {
//       const contracts = getContracts();

//       const levels = await mapWithConcurrency(
//         Array.from({ length: 10 }, (_, index) => index + 1),
//         LEVELS_FETCH_CONCURRENCY,
//         async (level) => {
//           const isActive = await safeOptionalRpc(() =>
//             contracts.registration.isLevelActivated(normalizedAddress, level)
//           ) || false;

//           return {
//             level,
//             orbitType: levelToOrbitType[level],
//             isActive: Boolean(isActive),
//           };
//         }
//       );

//       const activeLevels = levels
//         .filter((item) => item.isActive)
//         .map((item) => item.level);

//       const highestActiveLevel = activeLevels.length
//         ? Math.max(...activeLevels)
//         : 0;

//       return {
//         address: normalizedAddress,
//         levels,
//         highestActiveLevel,
//       };
//     },
//     5000
//   );
// }, {
//   address: null,
//   levels: [],
//   highestActiveLevel: 0
// });

// export const fetchOrbitLevelSnapshot = safeApiResponse(async function fetchOrbitLevelSnapshot(address, level) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);

//   const orbitType = levelToOrbitType[level];
//   const cacheKey = `orbit-level-snapshot:${normalizedAddress}:${level}`;

//   return cached(
//     cacheKey,
//     async () => {
//       let snapshot = await OrbitLevelSnapshot.findOne({
//         address: normalizedAddress,
//         level,
//       }).lean();

//       const latestActivity = await getLatestIndexedActivityForLevel(
//         normalizedAddress,
//         level,
//         orbitType
//       );

//       const isMissing = !snapshot;
//       const isIncomplete =
//         !snapshot?.metadata?.completeness?.positionsReady ||
//         !snapshot?.metadata?.completeness?.summaryReady;
//       const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
//       const isStale = isSnapshotStale(snapshot, LEVEL_SNAPSHOT_TTL_MS);

//       if (isMissing) {
//         logDebug('[LEVEL_SNAPSHOT_MISSING_REBUILD]', {
//           address: normalizedAddress,
//           level,
//         });

//         snapshot = await rebuildAndEnrichLevelSnapshot(
//           normalizedAddress,
//           level
//         );

//         if (!snapshot) {
//           return {
//             address: normalizedAddress,
//             level,
//             orbitType,
//             isLevelActive: false,
//             orbitSummary: {},
//             linePaymentCounts: {},
//             lockedForNextLevel: '0',
//             positions: [],
//             isFallback: true,
//           };
//         }
//       }

//       if (isIncomplete || hasNewIndexedActivity || isStale) {
//         refreshLevelSnapshotInBackground(normalizedAddress, level);
//       }

//       const totalCycles = Number(snapshot?.orbitSummary?.totalCycles || 0);

//       if (totalCycles > 0) {
//         warmCycleSnapshotsInBackground(normalizedAddress, level, totalCycles);
//       }

//       return {
//         address: normalizedAddress,
//         level,
//         orbitType,
//         isLevelActive: snapshot.isLevelActive || false,
//         orbitSummary: snapshot.orbitSummary || {},
//         linePaymentCounts: snapshot.linePaymentCounts || {},
//         lockedForNextLevel: snapshot.lockedForNextLevel || '0',
//         positions: snapshot.positions || [],
//       };
//     },
//     5000
//   );
// }, {
//   address: null,
//   level: 0,
//   orbitType: null,
//   isLevelActive: false,
//   orbitSummary: {},
//   linePaymentCounts: {},
//   lockedForNextLevel: '0',
//   positions: [],
//   isFallback: true
// });

// export const fetchOrbitPositionDetails = safeApiResponse(async function fetchOrbitPositionDetails(address, level, position) {
//   const { orbitType, positionsCount } = await getOrbitContext(level);
//   validatePosition(position, positionsCount);

//   const normalizedAddress = normalizeAddress(address);
//   const cacheKey = `orbit-position-details:${normalizedAddress}:${level}:${position}`;

//   return cached(
//     cacheKey,
//     async () => {
//       let snapshot = await OrbitPositionSnapshot.findOne({
//         address: normalizedAddress,
//         level,
//         position,
//       }).lean();

//       const latestActivity = await getLatestIndexedActivityForPosition(
//         normalizedAddress,
//         level,
//         orbitType,
//         position
//       );

//       const isMissing = !snapshot;
//       const isIncomplete =
//         !snapshot?.metadata?.completeness?.receiptsReady ||
//         !snapshot?.metadata?.completeness?.eventsReady;
//       const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
//       const isStale = isSnapshotStale(snapshot, POSITION_SNAPSHOT_TTL_MS);

//       if (isMissing) {
//         logDebug('[POSITION_SNAPSHOT_MISSING_REBUILD]', {
//           address: normalizedAddress,
//           level,
//           position,
//         });

//         snapshot = await rebuildPositionSnapshot(
//           normalizedAddress,
//           level,
//           position
//         );

//         if (!snapshot) {
//           return {
//             address: normalizedAddress,
//             level,
//             position,
//             orbitType,
//             number: position,
//             line: getLineForPosition(orbitType, position),
//             parentPosition: getStructuralParentPosition(orbitType, position),
//             occupant: null,
//             amount: '0.0',
//             timestamp: 0,
//             activationId: 0,
//             activationCycleNumber: 0,
//             isMirrorActivation: false,
//             truthLabel: 'NO_RECEIPT',
//             indexedEventCount: 0,
//             indexedReceiptCount: 0,
//             receiptTotals: buildEmptyReceiptTotals(),
//             viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
//             indexedReceipts: [],
//             indexedEvents: [],
//             ruleView: null,
//             isFallback: true,
//           };
//         }
//       }

//       if (isIncomplete || hasNewIndexedActivity || isStale) {
//         refreshPositionSnapshotInBackground(
//           normalizedAddress,
//           level,
//           position
//         );
//       }

//       return {
//         address: normalizedAddress,
//         level,
//         position,
//         orbitType,
//         number: snapshot.position,
//         line: snapshot.line,
//         parentPosition: snapshot.parentPosition,
//         occupant: snapshot.occupant,
//         amount: snapshot.amount,
//         timestamp: snapshot.timestamp,
//         activationId: snapshot.activationId,
//         activationCycleNumber: snapshot.activationCycleNumber,
//         isMirrorActivation: snapshot.isMirrorActivation,
//         truthLabel: snapshot.truthLabel,
//         indexedEventCount: snapshot.indexedEventCount,
//         indexedReceiptCount: snapshot.indexedReceiptCount,
//         receiptTotals: snapshot.receiptTotals,
//         viewerReceiptBreakdown: snapshot.viewerReceiptBreakdown,
//         indexedReceipts: snapshot.indexedReceipts || [],
//         indexedEvents: snapshot.indexedEvents || [],
//         ruleView: snapshot.ruleView || null,
//       };
//     },
//     5000
//   );
// }, {
//   address: null,
//   level: 0,
//   position: 0,
//   orbitType: null,
//   number: 0,
//   line: 0,
//   parentPosition: null,
//   occupant: null,
//   amount: '0.0',
//   timestamp: 0,
//   activationId: 0,
//   activationCycleNumber: 0,
//   isMirrorActivation: false,
//   truthLabel: 'NO_RECEIPT',
//   indexedEventCount: 0,
//   indexedReceiptCount: 0,
//   receiptTotals: buildEmptyReceiptTotals(),
//   viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
//   indexedReceipts: [],
//   indexedEvents: [],
//   ruleView: null,
//   isFallback: true
// });

// export const fetchOrbitCycleSnapshot = safeApiResponse(async function fetchOrbitCycleSnapshot(address, level, cycleNumber) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);
//   validateCycleNumber(cycleNumber);

//   const orbitType = levelToOrbitType[level];
//   const cacheKey = `orbit-cycle-snapshot:${normalizedAddress}:${level}:${cycleNumber}`;

//   return cached(
//     cacheKey,
//     async () => {
//       let snapshot = await OrbitCycleSnapshot.findOne({
//         address: normalizedAddress,
//         level,
//         cycleNumber,
//       }).lean();

//       const latestActivity = await getLatestIndexedActivityForCycle(
//         normalizedAddress,
//         level,
//         orbitType,
//         cycleNumber
//       );

//       const isMissing = !snapshot;
//       const isIncomplete =
//         !snapshot?.metadata?.completeness?.positionsReady ||
//         !snapshot?.metadata?.completeness?.historicalReady;
//       const hasNewIndexedActivity = hasIndexedActivityAdvanced(snapshot, latestActivity);
//       const isStale = isSnapshotStale(snapshot, CYCLE_SNAPSHOT_TTL_MS);

//       if (isMissing) {
//         logDebug('[CYCLE_SNAPSHOT_MISSING_REBUILD]', {
//           address: normalizedAddress,
//           level,
//           cycleNumber,
//         });

//         snapshot = await rebuildCycleSnapshot(
//           normalizedAddress,
//           level,
//           cycleNumber
//         );

//         if (!snapshot) {
//           return {
//             address: normalizedAddress,
//             level,
//             cycleNumber,
//             orbitType,
//             filledPositions: [],
//             totalPositions: getOrbitPositionCount(orbitType),
//             positions: [],
//             isFallback: true,
//           };
//         }
//       }

//       if (isIncomplete || hasNewIndexedActivity || isStale) {
//         refreshCycleSnapshotInBackground(
//           normalizedAddress,
//           level,
//           cycleNumber
//         );
//       }

//       return {
//         address: normalizedAddress,
//         level,
//         cycleNumber,
//         orbitType: snapshot.orbitType,
//         filledPositions: snapshot.filledPositions,
//         totalPositions: snapshot.totalPositions,
//         positions: snapshot.positions || [],
//       };
//     },
//     10000
//   );
// }, {
//   address: null,
//   level: 0,
//   cycleNumber: 0,
//   orbitType: null,
//   filledPositions: [],
//   totalPositions: 0,
//   positions: [],
//   isFallback: true
// });


// function decimalStringToNumber(value) {
//   const num = Number(value || 0);
//   return Number.isFinite(num) ? num : 0;
// }

// function formatNumber2(value) {
//   const num = Number(value || 0);
//   if (!Number.isFinite(num)) return '0.00';
//   return num.toFixed(2);
// }

// function sumReceiptMoney(receipts = []) {
//   return receipts.reduce(
//     (acc, receipt) => {
//       acc.totalGenerated += decimalStringToNumber(formatUsdt(receipt.grossAmount));
//       acc.totalLiquid += decimalStringToNumber(formatUsdt(receipt.liquidPaid));
//       acc.totalEscrowUsed += decimalStringToNumber(formatUsdt(receipt.escrowLocked));
//       acc.receiptCount += 1;
//       return acc;
//     },
//     {
//       totalGenerated: 0,
//       totalLiquid: 0,
//       totalEscrowUsed: 0,
//       receiptCount: 0,
//     }
//   );
// }

// function groupReceiptMoneyByLevel(receipts = []) {
//   const grouped = new Map();

//   for (const receipt of receipts) {
//     const level = Number(receipt.level || 0);
//     if (!level) continue;

//     if (!grouped.has(level)) {
//       grouped.set(level, {
//         level,
//         orbitType: levelToOrbitType[level] || '',
//         generated: 0,
//         liquid: 0,
//         escrowUsed: 0,
//         receiptCount: 0,
//       });
//     }

//     const item = grouped.get(level);

//     item.generated += decimalStringToNumber(formatUsdt(receipt.grossAmount));
//     item.liquid += decimalStringToNumber(formatUsdt(receipt.liquidPaid));
//     item.escrowUsed += decimalStringToNumber(formatUsdt(receipt.escrowLocked));
//     item.receiptCount += 1;
//   }

//   return Array.from(grouped.values())
//     .sort((a, b) => a.level - b.level)
//     .map((item) => ({
//       ...item,
//       generated: formatNumber2(item.generated),
//       liquid: formatNumber2(item.liquid),
//       escrowUsed: formatNumber2(item.escrowUsed),
//     }));
// }

// async function getCurrentEscrowLockSummary(address) {
//   const snapshots = await OrbitLevelSnapshot.find({
//     address,
//   })
//     .select({
//       level: 1,
//       isLevelActive: 1,
//       lockedForNextLevel: 1,
//       orbitSummary: 1,
//     })
//     .lean();

//   const activeSnapshots = snapshots
//     .filter((snapshot) => snapshot?.isLevelActive)
//     .sort((a, b) => Number(a.level || 0) - Number(b.level || 0));

//   const highestLevel = activeSnapshots.length
//     ? Math.max(...activeSnapshots.map((snapshot) => Number(snapshot.level || 0)))
//     : 0;

//   const currentLockByLevel = activeSnapshots.map((snapshot) => {
//     const level = Number(snapshot.level || 0);
//     const config = LEVEL_CONFIG[level] || {};
//     const currentLocked = decimalStringToNumber(snapshot.lockedForNextLevel);
//     const upgradeRequired = Number(config.upgradeReq || 0);
//     const remainingToNextUpgrade =
//       level >= 10 || upgradeRequired <= 0
//         ? 0
//         : Math.max(0, upgradeRequired - currentLocked);

//     return {
//       level,
//       orbitType: levelToOrbitType[level] || '',
//       nextLevel: config.nextLevel || null,
//       currentLocked: formatNumber2(currentLocked),
//       upgradeRequired: formatNumber2(upgradeRequired),
//       remainingToNextUpgrade: formatNumber2(remainingToNextUpgrade),
//       autoUpgradeCompleted: Boolean(snapshot?.orbitSummary?.autoUpgradeCompleted),
//       isHighestActiveLevel: level === highestLevel,
//     };
//   });

//   const highestActiveLock =
//     currentLockByLevel.find((item) => item.isHighestActiveLevel) || null;

//   const currentEscrowLocked = currentLockByLevel.reduce((sum, item) => {
//     return sum + decimalStringToNumber(item.currentLocked);
//   }, 0);

//   return {
//     highestLevel,
//     currentEscrowLocked: formatNumber2(currentEscrowLocked),
//     remainingToNextUpgrade: highestActiveLock?.remainingToNextUpgrade || '0.00',
//     highestActiveLock,
//     byLevel: currentLockByLevel,
//   };
// }

// // export const fetchUserGlobalSummary = safeApiResponse(async function(address) {
// //   const normalizedAddress = normalizeAddress(address);

// //   // 1. Fetch all data in parallel for speed
// //   const [receipts, tokenEvents] = await Promise.all([
// //     IndexedReceipt.find({ receiver: normalizedAddress }).lean(),
// //     IndexedTokenEvent.find({ userAddress: normalizedAddress }).sort({ timestamp: -1 }).lean()
// //   ]);

// //   // 2. Process Earnings (Using your existing summarizer)
// //   const earningsSummary = summarizeReceiptsForViewer(receipts, normalizedAddress);

// //   // 3. Process Token Totals (FGT/FGTr)
// //   const tokenTotals = tokenEvents.reduce((acc, event) => {
// //     const amt = BigInt(event.amount || '0');
// //     const symbol = event.tokenSymbol; // 'FGT' or 'FGTr'
    
// //     if (!acc[symbol]) acc[symbol] = { minted: 0n, burned: 0n, locked: 0n };
    
// //     if (event.eventName === 'UtilityMinted') acc[symbol].minted += amt;
// //     if (event.eventName === 'UtilityBurned') acc[symbol].burned += amt;
// //     if (event.eventName === 'UtilityLocked') acc[symbol].locked += amt;
    
// //     return acc;
// //   }, {});

// //   // 4. Final Formatting
// //   const tokens = {};
// //   for (const sym in tokenTotals) {
// //     tokens[sym] = {
// //       total: formatUsdt(tokenTotals[sym].minted),
// //       burned: formatUsdt(tokenTotals[sym].burned),
// //       locked: formatUsdt(tokenTotals[sym].locked),
// //       available: formatUsdt(tokenTotals[sym].minted - tokenTotals[sym].burned - tokenTotals[sym].locked)
// //     };
// //   }

// //   return {
// //     address: normalizedAddress,
// //     earnings: earningsSummary.viewerBreakdown,
// //     tokens,
// //     history: tokenEvents.map(e => ({
// //       kind: e.eventName === 'UtilityMinted' ? (e.tokenSymbol === 'FGT' ? 'FGT_MINT' : 'FGTR_MINT') : 
// //             e.eventName === 'UtilityBurned' ? (e.tokenSymbol === 'FGT' ? 'FGT_BURN' : 'FGTR_BURN') : 'FGT_LOCK',
// //       token: e.tokenSymbol,
// //       amount: e.amount,
// //       amountFormatted: formatUsdt(e.amount),
// //       reason: e.reason.split(':')[0], // Return "manualActivation" without the ":2"
// //       level: e.level,
// //       txHash: e.txHash,
// //       timestamp: Math.floor(new Date(e.timestamp).getTime() / 1000)
// //     }))
// //   };
// // }, {});



// export const fetchUserGlobalSummary = safeApiResponse(async function(address) {
//   const normalizedAddress = normalizeAddress(address);

//   const [receipts, tokenEvents, lockSummary] = await Promise.all([
//     IndexedReceipt.find({ receiver: normalizedAddress }).lean(),
//     IndexedTokenEvent.find({ userAddress: normalizedAddress })
//       .sort({ timestamp: -1 })
//       .lean(),
//     getCurrentEscrowLockSummary(normalizedAddress),
//   ]);

//   const receiptTotals = sumReceiptMoney(receipts);
//   const byLevelFinancials = groupReceiptMoneyByLevel(receipts);

//   const earningsSummary = summarizeReceiptsForViewer(receipts, normalizedAddress);

//   const tokenTotals = tokenEvents.reduce((acc, event) => {
//     const amt = BigInt(event.amount || '0');
//     const symbol = event.tokenSymbol;

//     if (!acc[symbol]) acc[symbol] = { minted: 0n, burned: 0n, locked: 0n };

//     if (event.eventName === 'UtilityMinted') acc[symbol].minted += amt;
//     if (event.eventName === 'UtilityBurned') acc[symbol].burned += amt;
//     if (event.eventName === 'UtilityLocked') acc[symbol].locked += amt;

//     return acc;
//   }, {});

//   const tokens = {};
//   for (const sym in tokenTotals) {
//     tokens[sym] = {
//       total: formatUsdt(tokenTotals[sym].minted),
//       burned: formatUsdt(tokenTotals[sym].burned),
//       locked: formatUsdt(tokenTotals[sym].locked),
//       available: formatUsdt(
//         tokenTotals[sym].minted -
//           tokenTotals[sym].burned -
//           tokenTotals[sym].locked
//       ),
//     };
//   }

//   return {
//     address: normalizedAddress,

//     earnings: {
//       ...earningsSummary.viewerBreakdown,

//       totalGenerated: formatNumber2(receiptTotals.totalGenerated),
//       totalLiquid: formatNumber2(receiptTotals.totalLiquid),
//       totalEscrowUsed: formatNumber2(receiptTotals.totalEscrowUsed),
//       receiptCount: receiptTotals.receiptCount,

//       currentEscrowLocked: lockSummary.currentEscrowLocked,
//       remainingToNextUpgrade: lockSummary.remainingToNextUpgrade,
//       highestLevel: lockSummary.highestLevel,
//       highestActiveLock: lockSummary.highestActiveLock,
//       currentLocksByLevel: lockSummary.byLevel,

//       byLevel: byLevelFinancials.map((item) => {
//         const lock = lockSummary.byLevel.find((entry) => entry.level === item.level);

//         return {
//           ...item,
//           currentLocked: lock?.currentLocked || '0.00',
//           upgradeRequired: lock?.upgradeRequired || formatNumber2(LEVEL_CONFIG[item.level]?.upgradeReq || 0),
//           remainingToNextUpgrade: lock?.remainingToNextUpgrade || '0.00',
//           autoUpgradeCompleted: Boolean(lock?.autoUpgradeCompleted),
//         };
//       }),
//     },

//     tokens,

//     history: tokenEvents.map((e) => ({
//       kind:
//         e.eventName === 'UtilityMinted'
//           ? e.tokenSymbol === 'FGT'
//             ? 'FGT_MINT'
//             : 'FGTR_MINT'
//           : e.eventName === 'UtilityBurned'
//             ? e.tokenSymbol === 'FGT'
//               ? 'FGT_BURN'
//               : 'FGTR_BURN'
//             : 'FGT_LOCK',
//       token: e.tokenSymbol,
//       amount: e.amount,
//       amountFormatted: formatUsdt(e.amount),
//       reason: String(e.reason || '').split(':')[0],
//       level: e.level,
//       txHash: e.txHash,
//       timestamp: Math.floor(new Date(e.timestamp).getTime() / 1000),
//     })),
//   };
// }, {});

// export const getEarningsPerLevel = async (address) => {
//   const normalized = address.toLowerCase();

//   return await IndexedReceipt.aggregate([
//     { $match: { receiver: normalized } },
//     {
//       $group: {
//         _id: "$level", // Group by Level
//         totalEarned: { $sum: { $toDecimal: "$liquidPaid" } },
//         totalEscrow: { $sum: { $toDecimal: "$escrowLocked" } },
//         transactionCount: { $sum: 1 }
//       }
//     },
//     { $sort: { _id: 1 } }
//   ]);
// };
