import { ethers } from 'ethers';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';

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

const orbitTypeToContractKey = {
  P4: 'p4Orbit',
  P12: 'p12Orbit',
  P39: 'p39Orbit',
};

const RESPONSE_CACHE_TTL_MS = 10_000;
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

  return ethers.getAddress(address);
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
  if (types.has(RECEIPT_TYPES.DIRECT_OWNER) && types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)) {
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
      linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[3] ?? 0),
      autoUpgradeEnabled: Boolean(ruleResult.autoUpgradeEnabled ?? ruleResult[4] ?? false),
      hasStoredRuleData: Boolean(ruleResult.hasStoredRuleData ?? ruleResult[5] ?? false),
      isFounderNoReferrerPath: false,
      toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[6] ?? 0),
      toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[7] ?? 0),
      toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[8] ?? 0),
      toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[9] ?? 0),
      toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[10] ?? 0),
      spillover1Recipient: ruleResult.spillover1Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
      spillover2Recipient: ruleResult.spillover2Recipient ?? ruleResult[12] ?? ethers.ZeroAddress,
    };
  }

  return {
    position: Number(ruleResult.position ?? ruleResult[0] ?? 0),
    line: Number(ruleResult.line ?? ruleResult[1] ?? 0),
    linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[2] ?? 0),
    autoUpgradeEnabled: Boolean(ruleResult.autoUpgradeEnabled ?? ruleResult[3] ?? false),
    isFounderNoReferrerPath: Boolean(ruleResult.isFounderNoReferrerPath ?? ruleResult[4] ?? false),
    hasStoredRuleData: false,
    toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[5] ?? 0),
    toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[6] ?? 0),
    toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[7] ?? 0),
    toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[8] ?? 0),
    toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[9] ?? 0),
    spillover1Recipient: ruleResult.spillover1Recipient ?? ruleResult[10] ?? ethers.ZeroAddress,
    spillover2Recipient: ruleResult.spillover2Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
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

async function getLockedForNextLevel(contracts, address, level) {
  if (level >= 10) return 0n;

  if (typeof contracts.escrow.getLockedAmount === 'function') {
    return safeRpcCall(() => contracts.escrow.getLockedAmount(address, level, level + 1));
  }

  if (typeof contracts.escrow.lockedFunds === 'function') {
    return safeRpcCall(() => contracts.escrow.lockedFunds(address, level, level + 1));
  }

  return 0n;
}

async function tryCall(contract, methodNames, args) {
  for (const methodName of methodNames) {
    if (typeof contract?.[methodName] === 'function') {
      try {
        const result = await safeRpcCall(() => contract[methodName](...args));
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
    totals.escrowLocked = addBigIntStrings(totals.escrowLocked, receipt.escrowLocked);
    totals.liquidPaid = addBigIntStrings(totals.liquidPaid, receipt.liquidPaid);

    const type = Number(receipt.receiptType || 0);

    if (type === RECEIPT_TYPES.FOUNDER_PATH) {
      totals.founderPathGross = addBigIntStrings(totals.founderPathGross, receipt.grossAmount);
    } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
      totals.directOwnerGross = addBigIntStrings(totals.directOwnerGross, receipt.grossAmount);
    } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
      totals.routedSpilloverGross = addBigIntStrings(totals.routedSpilloverGross, receipt.grossAmount);
    } else if (type === RECEIPT_TYPES.RECYCLE) {
      totals.recycleGross = addBigIntStrings(totals.recycleGross, receipt.grossAmount);
    }

    if ((receipt.receiver || '').toLowerCase() !== lowerViewed) continue;

    viewer.count += 1;
    viewer.totalGross = addBigIntStrings(viewer.totalGross, receipt.grossAmount);
    viewer.totalLiquid = addBigIntStrings(viewer.totalLiquid, receipt.liquidPaid);
    viewer.totalEscrow = addBigIntStrings(viewer.totalEscrow, receipt.escrowLocked);

    if (type === RECEIPT_TYPES.FOUNDER_PATH) {
      viewer.founderPathGross = addBigIntStrings(viewer.founderPathGross, receipt.grossAmount);
      viewer.founderPathLiquid = addBigIntStrings(viewer.founderPathLiquid, receipt.liquidPaid);
      viewer.founderPathEscrow = addBigIntStrings(viewer.founderPathEscrow, receipt.escrowLocked);
    } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
      viewer.directOwnerGross = addBigIntStrings(viewer.directOwnerGross, receipt.grossAmount);
      viewer.directOwnerLiquid = addBigIntStrings(viewer.directOwnerLiquid, receipt.liquidPaid);
      viewer.directOwnerEscrow = addBigIntStrings(viewer.directOwnerEscrow, receipt.escrowLocked);
    } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
      viewer.routedSpilloverGross = addBigIntStrings(viewer.routedSpilloverGross, receipt.grossAmount);
      viewer.routedSpilloverLiquid = addBigIntStrings(viewer.routedSpilloverLiquid, receipt.liquidPaid);
      viewer.routedSpilloverEscrow = addBigIntStrings(viewer.routedSpilloverEscrow, receipt.escrowLocked);
    } else if (type === RECEIPT_TYPES.RECYCLE) {
      viewer.recycleGross = addBigIntStrings(viewer.recycleGross, receipt.grossAmount);
      viewer.recycleLiquid = addBigIntStrings(viewer.recycleLiquid, receipt.liquidPaid);
      viewer.recycleEscrow = addBigIntStrings(viewer.recycleEscrow, receipt.escrowLocked);
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

async function fetchHistoricalRuleView(orbitContract, address, level, cycleNumber, position) {
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

  const result = await safeRpcCall(() =>
    orbitContract.getPositionActivationData(address, level, position)
  );

  return {
    activationId: Number(result?.activationId ?? result?.[0] ?? 0),
    activationCycleNumber: Number(result?.cycleNumber ?? result?.[1] ?? 0),
    isMirrorActivation: Boolean(result?.isMirror ?? result?.[2] ?? false),
  };
}

async function fetchHistoricalActivationData(orbitContract, address, level, cycleNumber, position) {
  if (typeof orbitContract.getHistoricalPositionActivationData !== 'function') {
    return {
      activationId: 0,
      activationCycleNumber: cycleNumber,
      isMirrorActivation: false,
    };
  }

  const result = await safeRpcCall(() =>
    orbitContract.getHistoricalPositionActivationData(
      address,
      level,
      cycleNumber,
      position
    )
  );

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

function findBestIndexedPositionFilledEvent(indexedEvents = []) {
  return indexedEvents.find((event) => event.eventName === 'PositionFilled') || null;
}

function findActivationIdFromIndexedReceipts(receipts = [], cycleNumber, positionNumber) {
  const match = receipts.find(
    (receipt) =>
      Number(receipt.sourceCycle || 0) === Number(cycleNumber) &&
      Number(receipt.sourcePosition || 0) === Number(positionNumber) &&
      Number(receipt.activationId || 0) > 0
  );

  return match ? Number(match.activationId) : 0;
}

async function fetchIndexedReceiptsForHistoricalPosition(orbitOwner, level, cycleNumber, positionNumber) {
  return IndexedReceipt.find({
    orbitOwner: orbitOwner.toLowerCase(),
    level,
    sourceCycle: Number(cycleNumber),
    sourcePosition: Number(positionNumber),
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
}

async function getIndexedOrbitEventsGrouped(orbitOwner, level) {
  const docs = await IndexedOrbitEvent.find({
    orbitOwner: orbitOwner.toLowerCase(),
    level,
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();

  const byPosition = new Map();

  for (const doc of docs) {
    const pos = Number(doc.position || 0);
    if (!byPosition.has(pos)) {
      byPosition.set(pos, []);
    }
    byPosition.get(pos).push(doc);
  }

  return byPosition;
}

async function buildLivePositionSnapshot(address, level, positionNumber, preloaded = {}) {
  const normalizedAddress = normalizeAddress(address);
  const { orbitType, orbitContract } = await getOrbitContext(level);

  const [position, activationData, ruleView] = await Promise.all([
    safeRpcCall(() => orbitContract.getPosition(normalizedAddress, level, positionNumber)),
    fetchLiveActivationData(orbitContract, normalizedAddress, level, positionNumber),
    fetchLiveRuleView(orbitContract, normalizedAddress, level, positionNumber),
  ]);

  const indexedEvents = preloaded.indexedEventsByPosition?.get(positionNumber) || [];
  const occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
  const indexedReceipts = await fetchIndexedReceiptsForActivation(activationData.activationId);
  const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);

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

async function buildHistoricalPositionSnapshot(address, level, cycleNumber, positionNumber, preloaded = {}) {
  const normalizedAddress = normalizeAddress(address);
  const { orbitType, orbitContract } = await getOrbitContext(level);

  const indexedEvents = preloaded.indexedEventsByPosition?.get(positionNumber) || [];

  const indexedReceiptsForPosition = await fetchIndexedReceiptsForHistoricalPosition(
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
    const error = new Error('Historical position getter not supported by this orbit contract');
    error.status = 400;
    throw error;
  }

  const position = historicalPositionCall.result || [];
  let occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
  let amount = occupant ? formatUsdt(position?.[1]) : '0.0';
  let timestamp = Number(position?.[2] ?? 0);

  const [activationDataRaw, ruleView] = await Promise.all([
    fetchHistoricalActivationData(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
    fetchHistoricalRuleView(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
  ]);

  let activationId = Number(activationDataRaw.activationId || 0);
  let activationCycleNumber = Number(activationDataRaw.activationCycleNumber || cycleNumber);
  let isMirrorActivation = Boolean(activationDataRaw.isMirrorActivation || false);

  const bestIndexedPositionFilled = findBestIndexedPositionFilledEvent(indexedEvents);

  if (!occupant && bestIndexedPositionFilled) {
    occupant = bestIndexedPositionFilled.user || null;

    if (bestIndexedPositionFilled.amount) {
      amount = formatUsdt(bestIndexedPositionFilled.amount);
    }

    if (bestIndexedPositionFilled.timestamp) {
      timestamp = Math.floor(new Date(bestIndexedPositionFilled.timestamp).getTime() / 1000);
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

  const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);

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

export async function fetchOrbitLevels(address) {
  const normalizedAddress = normalizeAddress(address);
  const cacheKey = `orbit-levels:${normalizedAddress.toLowerCase()}`;

  return cached(cacheKey, async () => {
    const contracts = getContracts();

    const levels = await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index + 1),
      2,
      async (level) => {
        const isActive = await safeRpcCall(() =>
          contracts.registration.isLevelActivated(normalizedAddress, level)
        );

        return {
          level,
          orbitType: levelToOrbitType[level],
          isActive: Boolean(isActive),
        };
      }
    );

    const activeLevels = levels.filter((item) => item.isActive).map((item) => item.level);
    const highestActiveLevel = activeLevels.length ? Math.max(...activeLevels) : 0;

    return {
      address: normalizedAddress,
      levels,
      highestActiveLevel,
    };
  });
}

export async function fetchOrbitLevelSnapshot(address, level) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);

  const cacheKey = `orbit-level-snapshot:${normalizedAddress.toLowerCase()}:${level}`;

  return cached(cacheKey, async () => {
    const { contracts, orbitType, orbitContract, positionsCount } = await getOrbitContext(level);

    const [isLevelActive, userOrbit, lineCounts, lockedAmountRaw, indexedEventsByPosition] =
      await Promise.all([
        safeRpcCall(() => contracts.registration.isLevelActivated(normalizedAddress, level)),
        safeRpcCall(() => orbitContract.getUserOrbit(normalizedAddress, level)),
        safeRpcCall(() => orbitContract.getLinePaymentCounts(normalizedAddress, level)),
        getLockedForNextLevel(contracts, normalizedAddress, level),
        getIndexedOrbitEventsGrouped(normalizedAddress, level),
      ]);

    const positions = await mapWithConcurrency(
      Array.from({ length: positionsCount }, (_, idx) => idx + 1),
      2,
      async (positionNumber) => {
        const position = await safeRpcCall(() =>
          orbitContract.getPosition(normalizedAddress, level, positionNumber)
        ).catch(() => null);

        const occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
        const amount = occupant ? formatUsdt(position?.[1]) : '0.0';
        const timestamp = position?.[2] ? Number(position[2]) : 0;

        let activationId = 0;
        let activationCycleNumber = 0;
        let isMirrorActivation = false;

        if (typeof orbitContract.getPositionActivationData === 'function') {
          try {
            const activationData = await safeRpcCall(() =>
              orbitContract.getPositionActivationData(
                normalizedAddress,
                level,
                positionNumber
              )
            );

            activationId = Number(activationData?.[0] ?? activationData?.activationId ?? 0);
            activationCycleNumber = Number(activationData?.[1] ?? activationData?.cycleNumber ?? 0);
            isMirrorActivation = Boolean(activationData?.[2] ?? activationData?.isMirror ?? false);
          } catch {
            // keep defaults
          }
        }

        const indexedReceipts = activationId > 0
          ? await fetchIndexedReceiptsForActivation(activationId)
          : [];

        const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);
        const indexedEvents = indexedEventsByPosition.get(positionNumber) || [];

        return {
          number: positionNumber,
          line: getLineForPosition(orbitType, positionNumber),
          parentPosition: getStructuralParentPosition(orbitType, positionNumber),
          occupant,
          amount,
          timestamp,
          activationId,
          activationCycleNumber,
          isMirrorActivation,
          truthLabel: receiptSummary.truthLabel,
          indexedEventCount: indexedEvents.length,
          indexedReceiptCount: indexedReceipts.length,
          receiptTotals: receiptSummary.totals,
          viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
        };
      }
    );

    return {
      address: normalizedAddress,
      level,
      orbitType,
      isLevelActive: Boolean(isLevelActive),
      orbitSummary: {
        currentPosition: Number(userOrbit?.[0] ?? 0),
        escrowBalance: formatUsdt(userOrbit?.[1]),
        autoUpgradeCompleted: Boolean(userOrbit?.[2] ?? false),
        positionsInLine1: Number(userOrbit?.[3] ?? 0),
        positionsInLine2: Number(userOrbit?.[4] ?? 0),
        positionsInLine3: Number(userOrbit?.[5] ?? 0),
        totalCycles: Number(userOrbit?.[6] ?? 0),
        totalEarned: formatUsdt(userOrbit?.[7]),
      },
      linePaymentCounts: {
        line1: Number(lineCounts?.[0] ?? 0),
        line2: Number(lineCounts?.[1] ?? 0),
        line3: Number(lineCounts?.[2] ?? 0),
      },
      lockedForNextLevel: level < 10 ? formatUsdt(lockedAmountRaw) : '0.0',
      positions,
    };
  });
}

export async function fetchOrbitPositionDetails(address, level, position) {
  const { orbitType, positionsCount } = await getOrbitContext(level);
  validatePosition(position, positionsCount);

  const normalizedAddress = normalizeAddress(address);
  const cacheKey = `orbit-position-details:${normalizedAddress.toLowerCase()}:${level}:${position}`;

  return cached(cacheKey, async () => {
    const indexedEventsByPosition = await getIndexedOrbitEventsGrouped(normalizedAddress, level);

    const snapshot = await buildLivePositionSnapshot(
      normalizedAddress,
      level,
      position,
      { indexedEventsByPosition }
    );

    return {
      address: normalizedAddress,
      level,
      position,
      orbitType,
      ...snapshot,
    };
  });
}

export async function fetchOrbitCycleSnapshot(address, level, cycleNumber) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);
  validateCycleNumber(cycleNumber);

  const cacheKey = `orbit-cycle-snapshot:${normalizedAddress.toLowerCase()}:${level}:${cycleNumber}`;

  return cached(cacheKey, async () => {
    const { orbitType, positionsCount } = await getOrbitContext(level);
    const indexedEventsByPosition = await getIndexedOrbitEventsGrouped(normalizedAddress, level);

    const positions = await mapWithConcurrency(
      Array.from({ length: positionsCount }, (_, idx) => idx + 1),
      2,
      async (positionNumber) => {
        return buildHistoricalPositionSnapshot(
          normalizedAddress,
          level,
          cycleNumber,
          positionNumber,
          { indexedEventsByPosition }
        );
      }
    );

    const filledPositions = positions.filter((item) => !!item.occupant).length;

    return {
      address: normalizedAddress,
      level,
      cycleNumber,
      orbitType,
      filledPositions,
      totalPositions: positionsCount,
      positions,
    };
  }, 15_000);
}











// import { ethers } from 'ethers';
// import { getContracts } from '../../blockchain/contracts.js';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';

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

// const orbitTypeToContractKey = {
//   P4: 'p4Orbit',
//   P12: 'p12Orbit',
//   P39: 'p39Orbit',
// };

// function normalizeAddress(address) {
//   if (!ethers.isAddress(address)) {
//     const error = new Error('Invalid wallet address');
//     error.status = 400;
//     throw error;
//   }

//   return ethers.getAddress(address);
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
//   if (types.has(RECEIPT_TYPES.DIRECT_OWNER) && types.has(RECEIPT_TYPES.ROUTED_SPILLOVER)) {
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
//       linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[3] ?? 0),
//       autoUpgradeEnabled: Boolean(ruleResult.autoUpgradeEnabled ?? ruleResult[4] ?? false),
//       hasStoredRuleData: Boolean(ruleResult.hasStoredRuleData ?? ruleResult[5] ?? false),
//       isFounderNoReferrerPath: false,
//       toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[6] ?? 0),
//       toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[7] ?? 0),
//       toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[8] ?? 0),
//       toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[9] ?? 0),
//       toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[10] ?? 0),
//       spillover1Recipient: ruleResult.spillover1Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
//       spillover2Recipient: ruleResult.spillover2Recipient ?? ruleResult[12] ?? ethers.ZeroAddress,
//     };
//   }

//   return {
//     position: Number(ruleResult.position ?? ruleResult[0] ?? 0),
//     line: Number(ruleResult.line ?? ruleResult[1] ?? 0),
//     linePaymentNumber: Number(ruleResult.linePaymentNumber ?? ruleResult[2] ?? 0),
//     autoUpgradeEnabled: Boolean(ruleResult.autoUpgradeEnabled ?? ruleResult[3] ?? false),
//     isFounderNoReferrerPath: Boolean(ruleResult.isFounderNoReferrerPath ?? ruleResult[4] ?? false),
//     hasStoredRuleData: false,
//     toOwner: formatUsdt(ruleResult.toOwner ?? ruleResult[5] ?? 0),
//     toSpillover1: formatUsdt(ruleResult.toSpillover1 ?? ruleResult[6] ?? 0),
//     toSpillover2: formatUsdt(ruleResult.toSpillover2 ?? ruleResult[7] ?? 0),
//     toEscrow: formatUsdt(ruleResult.toEscrow ?? ruleResult[8] ?? 0),
//     toRecycle: formatUsdt(ruleResult.toRecycle ?? ruleResult[9] ?? 0),
//     spillover1Recipient: ruleResult.spillover1Recipient ?? ruleResult[10] ?? ethers.ZeroAddress,
//     spillover2Recipient: ruleResult.spillover2Recipient ?? ruleResult[11] ?? ethers.ZeroAddress,
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

// async function getLockedForNextLevel(contracts, address, level) {
//   if (level >= 10) return 0n;

//   if (typeof contracts.escrow.getLockedAmount === 'function') {
//     return await contracts.escrow.getLockedAmount(address, level, level + 1);
//   }

//   if (typeof contracts.escrow.lockedFunds === 'function') {
//     return await contracts.escrow.lockedFunds(address, level, level + 1);
//   }

//   return 0n;
// }

// async function tryCall(contract, methodNames, args) {
//   for (const methodName of methodNames) {
//     if (typeof contract?.[methodName] === 'function') {
//       try {
//         const result = await contract[methodName](...args);
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
//     totals.escrowLocked = addBigIntStrings(totals.escrowLocked, receipt.escrowLocked);
//     totals.liquidPaid = addBigIntStrings(totals.liquidPaid, receipt.liquidPaid);

//     const type = Number(receipt.receiptType || 0);

//     if (type === RECEIPT_TYPES.FOUNDER_PATH) {
//       totals.founderPathGross = addBigIntStrings(totals.founderPathGross, receipt.grossAmount);
//     } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
//       totals.directOwnerGross = addBigIntStrings(totals.directOwnerGross, receipt.grossAmount);
//     } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
//       totals.routedSpilloverGross = addBigIntStrings(totals.routedSpilloverGross, receipt.grossAmount);
//     } else if (type === RECEIPT_TYPES.RECYCLE) {
//       totals.recycleGross = addBigIntStrings(totals.recycleGross, receipt.grossAmount);
//     }

//     if ((receipt.receiver || '').toLowerCase() !== lowerViewed) continue;

//     viewer.count += 1;
//     viewer.totalGross = addBigIntStrings(viewer.totalGross, receipt.grossAmount);
//     viewer.totalLiquid = addBigIntStrings(viewer.totalLiquid, receipt.liquidPaid);
//     viewer.totalEscrow = addBigIntStrings(viewer.totalEscrow, receipt.escrowLocked);

//     if (type === RECEIPT_TYPES.FOUNDER_PATH) {
//       viewer.founderPathGross = addBigIntStrings(viewer.founderPathGross, receipt.grossAmount);
//       viewer.founderPathLiquid = addBigIntStrings(viewer.founderPathLiquid, receipt.liquidPaid);
//       viewer.founderPathEscrow = addBigIntStrings(viewer.founderPathEscrow, receipt.escrowLocked);
//     } else if (type === RECEIPT_TYPES.DIRECT_OWNER) {
//       viewer.directOwnerGross = addBigIntStrings(viewer.directOwnerGross, receipt.grossAmount);
//       viewer.directOwnerLiquid = addBigIntStrings(viewer.directOwnerLiquid, receipt.liquidPaid);
//       viewer.directOwnerEscrow = addBigIntStrings(viewer.directOwnerEscrow, receipt.escrowLocked);
//     } else if (type === RECEIPT_TYPES.ROUTED_SPILLOVER) {
//       viewer.routedSpilloverGross = addBigIntStrings(viewer.routedSpilloverGross, receipt.grossAmount);
//       viewer.routedSpilloverLiquid = addBigIntStrings(viewer.routedSpilloverLiquid, receipt.liquidPaid);
//       viewer.routedSpilloverEscrow = addBigIntStrings(viewer.routedSpilloverEscrow, receipt.escrowLocked);
//     } else if (type === RECEIPT_TYPES.RECYCLE) {
//       viewer.recycleGross = addBigIntStrings(viewer.recycleGross, receipt.grossAmount);
//       viewer.recycleLiquid = addBigIntStrings(viewer.recycleLiquid, receipt.liquidPaid);
//       viewer.recycleEscrow = addBigIntStrings(viewer.recycleEscrow, receipt.escrowLocked);
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

//   return await IndexedReceipt.find({
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

// async function fetchHistoricalRuleView(orbitContract, address, level, cycleNumber, position) {
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

//   const result = await orbitContract.getPositionActivationData(address, level, position);

//   return {
//     activationId: Number(result?.activationId ?? result?.[0] ?? 0),
//     activationCycleNumber: Number(result?.cycleNumber ?? result?.[1] ?? 0),
//     isMirrorActivation: Boolean(result?.isMirror ?? result?.[2] ?? false),
//   };
// }

// async function fetchHistoricalActivationData(orbitContract, address, level, cycleNumber, position) {
//   if (typeof orbitContract.getHistoricalPositionActivationData !== 'function') {
//     return {
//       activationId: 0,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//     };
//   }

//   const result = await orbitContract.getHistoricalPositionActivationData(
//     address,
//     level,
//     cycleNumber,
//     position
//   );

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


// function findBestIndexedPositionFilledEvent(indexedEvents = []) {
//   return indexedEvents.find((event) => event.eventName === 'PositionFilled') || null;
// }

// function findActivationIdFromIndexedReceipts(receipts = [], cycleNumber, positionNumber) {
//   const match = receipts.find(
//     (receipt) =>
//       Number(receipt.sourceCycle || 0) === Number(cycleNumber) &&
//       Number(receipt.sourcePosition || 0) === Number(positionNumber) &&
//       Number(receipt.activationId || 0) > 0
//   );

//   return match ? Number(match.activationId) : 0;
// }

// async function fetchIndexedReceiptsForHistoricalPosition(orbitOwner, level, cycleNumber, positionNumber) {
//   return await IndexedReceipt.find({
//     orbitOwner: orbitOwner.toLowerCase(),
//     level,
//     sourceCycle: Number(cycleNumber),
//     sourcePosition: Number(positionNumber),
//   })
//     .sort({ blockNumber: 1, logIndex: 1 })
//     .lean();
// }


// async function buildLivePositionSnapshot(address, level, positionNumber) {
//   const normalizedAddress = normalizeAddress(address);
//   const { orbitType, orbitContract } = await getOrbitContext(level);

//   const [position, activationData, ruleView, indexedEvents] = await Promise.all([
//     orbitContract.getPosition(normalizedAddress, level, positionNumber),
//     fetchLiveActivationData(orbitContract, normalizedAddress, level, positionNumber),
//     fetchLiveRuleView(orbitContract, normalizedAddress, level, positionNumber),
//     IndexedOrbitEvent.find({
//       orbitOwner: normalizedAddress.toLowerCase(),
//       level,
//       position: positionNumber,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),
//   ]);

//   const occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
//   const indexedReceipts = await fetchIndexedReceiptsForActivation(activationData.activationId);
//   const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);

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

// // async function buildHistoricalPositionSnapshot(address, level, cycleNumber, positionNumber) {
// //   const normalizedAddress = normalizeAddress(address);
// //   const { orbitType, orbitContract } = await getOrbitContext(level);

// //   const historicalPositionCall = await tryCall(
// //     orbitContract,
// //     ['getHistoricalPosition', 'getCyclePosition', 'getStoredCyclePosition', 'getArchivedPosition'],
// //     [normalizedAddress, level, cycleNumber, positionNumber]
// //   );

// //   if (!historicalPositionCall.ok) {
// //     const error = new Error('Historical position getter not supported by this orbit contract');
// //     error.status = 400;
// //     throw error;
// //   }

// //   const position = historicalPositionCall.result;
// //   const occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;

// //   const [activationData, ruleView] = await Promise.all([
// //     fetchHistoricalActivationData(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
// //     fetchHistoricalRuleView(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
// //   ]);

// //   const indexedReceipts = await fetchIndexedReceiptsForActivation(activationData.activationId);
// //   const indexedEvents = await IndexedOrbitEvent.find({
// //     orbitOwner: normalizedAddress.toLowerCase(),
// //     level,
// //     position: positionNumber,
// //   })
// //     .sort({ blockNumber: 1, logIndex: 1 })
// //     .lean();

// //   const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);

// //   return {
// //     number: positionNumber,
// //     level,
// //     cycleNumber,
// //     orbitType,
// //     line: getLineForPosition(orbitType, positionNumber),
// //     parentPosition: getStructuralParentPosition(orbitType, positionNumber),
// //     occupant,
// //     amount: occupant ? formatUsdt(position?.[1]) : '0.0',
// //     timestamp: Number(position?.[2] ?? 0),
// //     activationId: activationData.activationId,
// //     activationCycleNumber: activationData.activationCycleNumber,
// //     isMirrorActivation: activationData.isMirrorActivation,
// //     truthLabel: receiptSummary.truthLabel,
// //     indexedEventCount: indexedEvents.length,
// //     indexedReceiptCount: indexedReceipts.length,
// //     receiptTotals: receiptSummary.totals,
// //     viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
// //     indexedReceipts: shapeIndexedReceipts(indexedReceipts),
// //     indexedEvents,
// //     ruleView,
// //   };
// // }

// async function buildHistoricalPositionSnapshot(address, level, cycleNumber, positionNumber) {
//   const normalizedAddress = normalizeAddress(address);
//   const { orbitType, orbitContract } = await getOrbitContext(level);

//   const indexedEvents = await IndexedOrbitEvent.find({
//     orbitOwner: normalizedAddress.toLowerCase(),
//     level,
//     position: positionNumber,
//   })
//     .sort({ blockNumber: 1, logIndex: 1 })
//     .lean();

//   const indexedReceiptsForPosition = await fetchIndexedReceiptsForHistoricalPosition(
//     normalizedAddress,
//     level,
//     cycleNumber,
//     positionNumber
//   );

//   const historicalPositionCall = await tryCall(
//     orbitContract,
//     ['getHistoricalPosition', 'getCyclePosition', 'getStoredCyclePosition', 'getArchivedPosition'],
//     [normalizedAddress, level, cycleNumber, positionNumber]
//   );

//   if (!historicalPositionCall.ok) {
//     const error = new Error('Historical position getter not supported by this orbit contract');
//     error.status = 400;
//     throw error;
//   }

//   const position = historicalPositionCall.result || [];
//   let occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
//   let amount = occupant ? formatUsdt(position?.[1]) : '0.0';
//   let timestamp = Number(position?.[2] ?? 0);

//   const [activationDataRaw, ruleView] = await Promise.all([
//     fetchHistoricalActivationData(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
//     fetchHistoricalRuleView(orbitContract, normalizedAddress, level, cycleNumber, positionNumber),
//   ]);

//   let activationId = Number(activationDataRaw.activationId || 0);
//   let activationCycleNumber = Number(activationDataRaw.activationCycleNumber || cycleNumber);
//   let isMirrorActivation = Boolean(activationDataRaw.isMirrorActivation || false);

//   const bestIndexedPositionFilled = findBestIndexedPositionFilledEvent(indexedEvents);

//   // Fallback 1: recover occupant/amount/timestamp from indexed PositionFilled event
//   if (!occupant && bestIndexedPositionFilled) {
//     occupant = bestIndexedPositionFilled.user || null;

//     if (bestIndexedPositionFilled.amount) {
//       amount = formatUsdt(bestIndexedPositionFilled.amount);
//     }

//     if (bestIndexedPositionFilled.timestamp) {
//       timestamp = Math.floor(new Date(bestIndexedPositionFilled.timestamp).getTime() / 1000);
//     }
//   }

//   // Fallback 2: recover activationId from indexed receipts
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

//   const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);

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

// export async function fetchOrbitLevels(address) {
//   const normalizedAddress = normalizeAddress(address);
//   const contracts = getContracts();

//   const levels = await Promise.all(
//     Array.from({ length: 10 }, async (_, index) => {
//       const level = index + 1;
//       const isActive = await contracts.registration.isLevelActivated(normalizedAddress, level);
//       return {
//         level,
//         orbitType: levelToOrbitType[level],
//         isActive: Boolean(isActive),
//       };
//     })
//   );

//   const activeLevels = levels.filter((item) => item.isActive).map((item) => item.level);
//   const highestActiveLevel = activeLevels.length ? Math.max(...activeLevels) : 0;

//   return {
//     address: normalizedAddress,
//     levels,
//     highestActiveLevel,
//   };
// }

// export async function fetchOrbitLevelSnapshot(address, level) {
//   const normalizedAddress = normalizeAddress(address);
//   const { contracts, orbitType, orbitContract, positionsCount } = await getOrbitContext(level);

//   const [
//     isLevelActive,
//     userOrbit,
//     lineCounts,
//     lockedAmountRaw,
//   ] = await Promise.all([
//     contracts.registration.isLevelActivated(normalizedAddress, level),
//     orbitContract.getUserOrbit(normalizedAddress, level),
//     orbitContract.getLinePaymentCounts(normalizedAddress, level),
//     getLockedForNextLevel(contracts, normalizedAddress, level),
//   ]);

//   const positions = await Promise.all(
//     Array.from({ length: positionsCount }, async (_, idx) => {
//       const positionNumber = idx + 1;
//       const position = await orbitContract.getPosition(normalizedAddress, level, positionNumber).catch(() => null);

//       const occupant = position?.[0] && position[0] !== ethers.ZeroAddress ? position[0] : null;
//       const amount = occupant ? formatUsdt(position?.[1]) : '0.0';
//       const timestamp = position?.[2] ? Number(position[2]) : 0;

//       let activationId = 0;
//       let activationCycleNumber = 0;
//       let isMirrorActivation = false;

//       if (typeof orbitContract.getPositionActivationData === 'function') {
//         try {
//           const activationData = await orbitContract.getPositionActivationData(
//             normalizedAddress,
//             level,
//             positionNumber
//           );

//           activationId = Number(activationData?.[0] ?? activationData?.activationId ?? 0);
//           activationCycleNumber = Number(activationData?.[1] ?? activationData?.cycleNumber ?? 0);
//           isMirrorActivation = Boolean(activationData?.[2] ?? activationData?.isMirror ?? false);
//         } catch {
//           // keep defaults
//         }
//       }

//       const indexedReceipts = activationId > 0
//         ? await fetchIndexedReceiptsForActivation(activationId)
//         : [];

//       const receiptSummary = summarizeReceiptsForViewer(indexedReceipts, normalizedAddress);
//       const indexedEventCount = await IndexedOrbitEvent.countDocuments({
//         orbitOwner: normalizedAddress.toLowerCase(),
//         level,
//         position: positionNumber,
//       });

//       return {
//         number: positionNumber,
//         line: getLineForPosition(orbitType, positionNumber),
//         parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//         occupant,
//         amount,
//         timestamp,
//         activationId,
//         activationCycleNumber,
//         isMirrorActivation,
//         truthLabel: receiptSummary.truthLabel,
//         indexedEventCount,
//         indexedReceiptCount: indexedReceipts.length,
//         receiptTotals: receiptSummary.totals,
//         viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
//       };
//     })
//   );

//   return {
//     address: normalizedAddress,
//     level,
//     orbitType,
//     isLevelActive: Boolean(isLevelActive),
//     orbitSummary: {
//       currentPosition: Number(userOrbit?.[0] ?? 0),
//       escrowBalance: formatUsdt(userOrbit?.[1]),
//       autoUpgradeCompleted: Boolean(userOrbit?.[2] ?? false),
//       positionsInLine1: Number(userOrbit?.[3] ?? 0),
//       positionsInLine2: Number(userOrbit?.[4] ?? 0),
//       positionsInLine3: Number(userOrbit?.[5] ?? 0),
//       totalCycles: Number(userOrbit?.[6] ?? 0),
//       totalEarned: formatUsdt(userOrbit?.[7]),
//     },
//     linePaymentCounts: {
//       line1: Number(lineCounts?.[0] ?? 0),
//       line2: Number(lineCounts?.[1] ?? 0),
//       line3: Number(lineCounts?.[2] ?? 0),
//     },
//     lockedForNextLevel: level < 10 ? formatUsdt(lockedAmountRaw) : '0.0',
//     positions,
//   };
// }

// export async function fetchOrbitPositionDetails(address, level, position) {
//   const { orbitType, positionsCount } = await getOrbitContext(level);
//   validatePosition(position, positionsCount);

//   const snapshot = await buildLivePositionSnapshot(address, level, position);

//   return {
//     address: normalizeAddress(address),
//     level,
//     position,
//     orbitType,
//     ...snapshot,
//   };
// }

// export async function fetchOrbitCycleSnapshot(address, level, cycleNumber) {
//   const normalizedAddress = normalizeAddress(address);
//   validateCycleNumber(cycleNumber);

//   const { orbitType, positionsCount } = await getOrbitContext(level);

//   const positions = await Promise.all(
//     Array.from({ length: positionsCount }, async (_, idx) => {
//       return await buildHistoricalPositionSnapshot(
//         normalizedAddress,
//         level,
//         cycleNumber,
//         idx + 1
//       );
//     })
//   );

//   const filledPositions = positions.filter((item) => !!item.occupant).length;

//   return {
//     address: normalizedAddress,
//     level,
//     cycleNumber,
//     orbitType,
//     filledPositions,
//     totalPositions: positionsCount,
//     positions,
//   };
// }