import { ethers } from 'ethers';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';
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

function isDebugLoggingEnabled() {
  return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
}

function logDebug(...args) {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
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

function getOrbitType(level) {
  return levelToOrbitType[level];
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

function shapeIndexedEvents(events) {
  return events.map((event) => ({
    txHash: event.txHash,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    eventName: event.eventName,
    orbitOwner: event.orbitOwner,
    user: event.user,
    level: event.level,
    position: event.position,
    amount: event.amount,
    cycleNumber: event.cycleNumber,
    line: event.line,
    linePaymentNumber: event.linePaymentNumber,
    timestamp: event.timestamp,
    raw: event.raw,
  }));
}

function toSnapshotTimestamp(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function buildCycleRuleViewFromIndexedEvents(eventsForPosition) {
  const paymentRule = [...eventsForPosition]
    .reverse()
    .find((event) => event.eventName === 'PaymentRuleApplied');

  if (!paymentRule?.raw) return null;

  return {
    position: Number(paymentRule.position || 0),
    line: Number(paymentRule.line || 0),
    linePaymentNumber: Number(paymentRule.linePaymentNumber || 0),
    autoUpgradeEnabled: false,
    isFounderNoReferrerPath: false,
    hasStoredRuleData: false,
    toOwner: formatUsdt(paymentRule.raw?.['5'] || '0'),
    toSpillover1: formatUsdt(paymentRule.raw?.['6'] || '0'),
    toSpillover2: formatUsdt(paymentRule.raw?.['7'] || '0'),
    toEscrow: formatUsdt(paymentRule.raw?.['8'] || '0'),
    toRecycle: formatUsdt(paymentRule.raw?.['9'] || '0'),
    spillover1Recipient: '',
    spillover2Recipient: '',
  };
}

function compareChainPoint(aBlock, aLog, bBlock, bLog) {
  const blockDiff = Number(aBlock || 0) - Number(bBlock || 0);
  if (blockDiff !== 0) return blockDiff;
  return Number(aLog || 0) - Number(bLog || 0);
}

function sortByChainPoint(items) {
  return [...items].sort(
    (a, b) =>
      compareChainPoint(a.blockNumber, a.logIndex, b.blockNumber, b.logIndex)
  );
}

function getResetEvents(events) {
  return sortByChainPoint(
    events.filter((event) => event.eventName === 'OrbitReset')
  );
}

function getCycleBoundary(events, cycleNumber) {
  const resetEvents = getResetEvents(events);

  const previousReset = cycleNumber > 1 ? resetEvents[cycleNumber - 2] || null : null;
  const currentReset = resetEvents[cycleNumber - 1] || null;

  if (!currentReset) return null;

  return {
    previousReset,
    currentReset,
  };
}

function isWithinCycleBoundary(item, boundary) {
  if (!boundary?.currentReset) return false;

  const afterPrevious =
    !boundary.previousReset ||
    compareChainPoint(
      item.blockNumber,
      item.logIndex || 0,
      boundary.previousReset.blockNumber,
      boundary.previousReset.logIndex || 0
    ) > 0;

  const beforeCurrent =
    compareChainPoint(
      item.blockNumber,
      item.logIndex || 0,
      boundary.currentReset.blockNumber,
      boundary.currentReset.logIndex || 0
    ) < 0;

  return afterPrevious && beforeCurrent;
}

function groupByPosition(items, positionField) {
  const byPosition = new Map();

  for (const item of items) {
    const pos = Number(item[positionField] || 0);
    if (pos <= 0) continue;

    if (!byPosition.has(pos)) {
      byPosition.set(pos, []);
    }

    byPosition.get(pos).push(item);
  }

  return byPosition;
}

function findActivationIdFromReceipts(receipts = []) {
  const match = receipts.find((receipt) => Number(receipt.activationId || 0) > 0);
  return match ? Number(match.activationId || 0) : 0;
}

function countFilledPositions(positions = []) {
  return positions.filter((position) => !!position?.occupant).length;
}

function shouldPreserveExistingCycleSnapshot({
  existingSnapshot,
  rebuiltPositions,
  cycleEvents,
  cycleReceipts,
}) {
  if (!existingSnapshot?.positions?.length) return false;

  const existingFilled = countFilledPositions(existingSnapshot.positions);
  const rebuiltFilled = countFilledPositions(rebuiltPositions);

  if (existingFilled === 0) return false;
  if (rebuiltFilled >= existingFilled) return false;

  const rebuiltHasNoSignal =
    (cycleEvents?.length || 0) === 0 &&
    (cycleReceipts?.length || 0) === 0;

  if (rebuiltHasNoSignal) return true;
  if (rebuiltFilled === 0 && existingFilled > 0) return true;

  return false;
}

function preserveExistingCycleSnapshot({
  existingSnapshot,
  rebuiltPositions,
  cycleNumber,
  totalPositions,
  boundary,
  fallbackMode,
}) {
  const existingPositions = Array.isArray(existingSnapshot?.positions)
    ? existingSnapshot.positions
    : [];

  return {
    filledPositions: countFilledPositions(existingPositions),
    positions: existingPositions.map((position) => ({
      ...position,
      cycleNumber,
      activationCycleNumber:
        Number(position?.activationCycleNumber || 0) || cycleNumber,
    })),
    metadata: {
      snapshotVersion: 6,
      builtAt: new Date(),
      completeness: {
        positionsReady: true,
        historicalReady: true,
      },
      cycleDerivation: {
        usedResetBoundary: !!boundary,
        fallbackUsed: fallbackMode,
        fallbackMode: fallbackMode ? 'event-cycle-number' : 'reset-boundary',
        previousResetBlock: Number(boundary?.previousReset?.blockNumber || 0),
        previousResetLogIndex: Number(boundary?.previousReset?.logIndex || 0),
        currentResetBlock: Number(boundary?.currentReset?.blockNumber || 0),
        currentResetLogIndex: Number(boundary?.currentReset?.logIndex || 0),
        preservedFromExisting: true,
      },
    },
    totalPositions: Number(existingSnapshot?.totalPositions || totalPositions || 0),
    orbitType: existingSnapshot?.orbitType || rebuiltPositions?.[0]?.orbitType || null,
  };
}

export async function buildOrbitCycleSnapshot(address, level, cycleNumber, options = {}) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);
  validateCycleNumber(cycleNumber);

  const orbitType = getOrbitType(level);
  if (!orbitType) {
    const error = new Error(`Unsupported level ${level}`);
    error.status = 400;
    throw error;
  }

  const totalPositions = getOrbitPositionCount(orbitType);
  const builtFromBlock = Number(options.builtFromBlock || 0);
  const freshnessBlock = Number(options.freshnessBlock || builtFromBlock || 0);

  const [existingSnapshot, allIndexedEvents, allIndexedReceipts] = await Promise.all([
    OrbitCycleSnapshot.findOne({
      address: normalizedAddress,
      level,
      cycleNumber,
    }).lean(),

    IndexedOrbitEvent.find({
      orbitOwner: normalizedAddress,
      level,
      orbitType,
    })
      .sort({ blockNumber: 1, logIndex: 1 })
      .lean(),

    IndexedReceipt.find({
      orbitOwner: normalizedAddress,
      level,
    })
      .sort({ blockNumber: 1, logIndex: 1 })
      .lean(),
  ]);

  const boundary = getCycleBoundary(allIndexedEvents, cycleNumber);

  let cycleReceipts;
  if (boundary) {
    cycleReceipts = allIndexedReceipts.filter((receipt) =>
      isWithinCycleBoundary(receipt, boundary)
    );
  } else {
    cycleReceipts = allIndexedReceipts.filter(
      (receipt) => Number(receipt.sourceCycle || 0) === cycleNumber
    );
  }

  let cycleEvents;
  let fallbackMode = false;

  if (boundary) {
    cycleEvents = allIndexedEvents.filter(
      (event) =>
        event.eventName !== 'OrbitReset' &&
        isWithinCycleBoundary(event, boundary)
    );
  } else {
    cycleEvents = allIndexedEvents.filter(
      (event) =>
        event.eventName !== 'OrbitReset' &&
        Number(event.cycleNumber || 0) === cycleNumber
    );
    fallbackMode = true;
  }

  if (cycleEvents.length === 0 && cycleReceipts.length === 0) {
    if (existingSnapshot?.positions?.length) {
      logDebug('[ORBIT_CYCLE_SNAPSHOT_REUSED_EXISTING_ON_EMPTY_REBUILD]', {
        address: normalizedAddress,
        level,
        cycleNumber,
        orbitType,
      });

      return existingSnapshot;
    }

    const error = new Error(`Cycle ${cycleNumber} is not available yet`);
    error.status = 404;
    throw error;
  }

  const eventsByPosition = groupByPosition(cycleEvents, 'position');
  const receiptsByPosition = groupByPosition(cycleReceipts, 'sourcePosition');

  let positions = [];

  for (let positionNumber = 1; positionNumber <= totalPositions; positionNumber += 1) {
    const eventsForPosition = sortByChainPoint(
      eventsByPosition.get(positionNumber) || []
    );
    const receiptsForPosition = sortByChainPoint(
      receiptsByPosition.get(positionNumber) || []
    );

    const latestFill = [...eventsForPosition]
      .reverse()
      .find((event) => event.eventName === 'PositionFilled');

    const receiptSummary = summarizeReceiptsForViewer(
      receiptsForPosition,
      normalizedAddress
    );
    const ruleView = buildCycleRuleViewFromIndexedEvents(eventsForPosition);
    const activationId = findActivationIdFromReceipts(receiptsForPosition);

    positions.push({
      number: positionNumber,
      level,
      cycleNumber,
      orbitType,
      line: getLineForPosition(orbitType, positionNumber),
      parentPosition: getStructuralParentPosition(orbitType, positionNumber),
      occupant: latestFill?.user || null,
      amount: latestFill ? formatUsdt(latestFill.amount || '0') : '0.0',
      timestamp: latestFill ? toSnapshotTimestamp(latestFill.timestamp) : 0,
      activationId,
      activationCycleNumber: cycleNumber,
      isMirrorActivation: false,
      truthLabel: receiptSummary.truthLabel,
      indexedEventCount: eventsForPosition.length,
      indexedReceiptCount: receiptsForPosition.length,
      receiptTotals: receiptSummary.totals,
      viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
      indexedReceipts: shapeIndexedReceipts(receiptsForPosition),
      indexedEvents: shapeIndexedEvents(eventsForPosition),
      ruleView,
    });
  }

  let filledPositions = positions.filter((item) => !!item.occupant).length;
  let preservedFromExisting = false;

  if (
    shouldPreserveExistingCycleSnapshot({
      existingSnapshot,
      rebuiltPositions: positions,
      cycleEvents,
      cycleReceipts,
    })
  ) {
    const preserved = preserveExistingCycleSnapshot({
      existingSnapshot,
      rebuiltPositions: positions,
      cycleNumber,
      totalPositions,
      boundary,
      fallbackMode,
    });

    positions = preserved.positions;
    filledPositions = preserved.filledPositions;
    preservedFromExisting = true;
  }

  const update = {
    address: normalizedAddress,
    level,
    cycleNumber,
    orbitType,
    filledPositions,
    totalPositions,
    positions,
    metadata: {
      snapshotVersion: 6,
      builtFromBlock,
      builtAt: new Date(),
      freshnessBlock,
      completeness: {
        positionsReady: true,
        historicalReady: true,
      },
      cycleDerivation: {
        usedResetBoundary: !!boundary,
        fallbackUsed: fallbackMode,
        fallbackMode: fallbackMode ? 'event-cycle-number' : 'reset-boundary',
        previousResetBlock: Number(boundary?.previousReset?.blockNumber || 0),
        previousResetLogIndex: Number(boundary?.previousReset?.logIndex || 0),
        currentResetBlock: Number(boundary?.currentReset?.blockNumber || 0),
        currentResetLogIndex: Number(boundary?.currentReset?.logIndex || 0),
        preservedFromExisting,
      },
    },
  };

  const snapshot = await OrbitCycleSnapshot.findOneAndUpdate(
    { address: normalizedAddress, level, cycleNumber },
    { $set: update },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    }
  ).lean();

  logDebug('[ORBIT_CYCLE_SNAPSHOT_BUILT]', {
    address: normalizedAddress,
    level,
    cycleNumber,
    orbitType,
    filledPositions,
    totalPositions,
    usedResetBoundary: !!boundary,
    fallbackMode,
    preservedFromExisting,
    cycleEventsCount: cycleEvents.length,
    cycleReceiptsCount: cycleReceipts.length,
  });

  return snapshot;
}













//==========================
// THIRD VERSION
//============================
// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';
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

// function isDebugLoggingEnabled() {
//   return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
// }

// function logDebug(...args) {
//   if (isDebugLoggingEnabled()) {
//     console.log(...args);
//   }
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

// function getOrbitType(level) {
//   return levelToOrbitType[level];
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

// function shapeIndexedEvents(events) {
//   return events.map((event) => ({
//     txHash: event.txHash,
//     logIndex: event.logIndex,
//     blockNumber: event.blockNumber,
//     eventName: event.eventName,
//     orbitOwner: event.orbitOwner,
//     user: event.user,
//     level: event.level,
//     position: event.position,
//     amount: event.amount,
//     cycleNumber: event.cycleNumber,
//     line: event.line,
//     linePaymentNumber: event.linePaymentNumber,
//     timestamp: event.timestamp,
//     raw: event.raw,
//   }));
// }

// function toSnapshotTimestamp(value) {
//   if (!value) return 0;
//   const ms = new Date(value).getTime();
//   if (!Number.isFinite(ms)) return 0;
//   return Math.floor(ms / 1000);
// }

// function buildCycleRuleViewFromIndexedEvents(eventsForPosition) {
//   const paymentRule = [...eventsForPosition]
//     .reverse()
//     .find((event) => event.eventName === 'PaymentRuleApplied');

//   if (!paymentRule?.raw) return null;

//   return {
//     position: Number(paymentRule.position || 0),
//     line: Number(paymentRule.line || 0),
//     linePaymentNumber: Number(paymentRule.linePaymentNumber || 0),
//     autoUpgradeEnabled: false,
//     isFounderNoReferrerPath: false,
//     hasStoredRuleData: false,
//     toOwner: formatUsdt(paymentRule.raw?.['5'] || '0'),
//     toSpillover1: formatUsdt(paymentRule.raw?.['6'] || '0'),
//     toSpillover2: formatUsdt(paymentRule.raw?.['7'] || '0'),
//     toEscrow: formatUsdt(paymentRule.raw?.['8'] || '0'),
//     toRecycle: formatUsdt(paymentRule.raw?.['9'] || '0'),
//     spillover1Recipient: '',
//     spillover2Recipient: '',
//   };
// }

// function compareChainPoint(aBlock, aLog, bBlock, bLog) {
//   const blockDiff = Number(aBlock || 0) - Number(bBlock || 0);
//   if (blockDiff !== 0) return blockDiff;
//   return Number(aLog || 0) - Number(bLog || 0);
// }

// function sortByChainPoint(items) {
//   return [...items].sort(
//     (a, b) =>
//       compareChainPoint(a.blockNumber, a.logIndex, b.blockNumber, b.logIndex)
//   );
// }

// function getResetEvents(events) {
//   return sortByChainPoint(
//     events.filter((event) => event.eventName === 'OrbitReset')
//   );
// }

// function getCycleBoundary(events, cycleNumber) {
//   const resetEvents = getResetEvents(events);

//   const previousReset = cycleNumber > 1 ? resetEvents[cycleNumber - 2] || null : null;
//   const currentReset = resetEvents[cycleNumber - 1] || null;

//   if (!currentReset) return null;

//   return {
//     previousReset,
//     currentReset,
//   };
// }

// function isWithinCycleBoundary(item, boundary) {
//   if (!boundary?.currentReset) return false;

//   const afterPrevious =
//     !boundary.previousReset ||
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.previousReset.blockNumber,
//       boundary.previousReset.logIndex || 0
//     ) > 0;

//   const beforeCurrent =
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.currentReset.blockNumber,
//       boundary.currentReset.logIndex || 0
//     ) < 0;

//   return afterPrevious && beforeCurrent;
// }

// function groupByPosition(items, positionField) {
//   const byPosition = new Map();

//   for (const item of items) {
//     const pos = Number(item[positionField] || 0);
//     if (pos <= 0) continue;

//     if (!byPosition.has(pos)) {
//       byPosition.set(pos, []);
//     }

//     byPosition.get(pos).push(item);
//   }

//   return byPosition;
// }

// function findActivationIdFromReceipts(receipts = []) {
//   const match = receipts.find((receipt) => Number(receipt.activationId || 0) > 0);
//   return match ? Number(match.activationId || 0) : 0;
// }

// export async function buildOrbitCycleSnapshot(address, level, cycleNumber, options = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);
//   validateCycleNumber(cycleNumber);

//   const orbitType = getOrbitType(level);
//   if (!orbitType) {
//     const error = new Error(`Unsupported level ${level}`);
//     error.status = 400;
//     throw error;
//   }

//   const totalPositions = getOrbitPositionCount(orbitType);
//   const builtFromBlock = Number(options.builtFromBlock || 0);
//   const freshnessBlock = Number(options.freshnessBlock || builtFromBlock || 0);

//   const [allIndexedEvents, allIndexedReceipts] = await Promise.all([
//     IndexedOrbitEvent.find({
//       orbitOwner: normalizedAddress,
//       level,
//       orbitType,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),

//     IndexedReceipt.find({
//       orbitOwner: normalizedAddress,
//       level,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),
//   ]);

//   const boundary = getCycleBoundary(allIndexedEvents, cycleNumber);

//   let cycleReceipts;
//   if (boundary) {
//     cycleReceipts = allIndexedReceipts.filter((receipt) =>
//       isWithinCycleBoundary(receipt, boundary)
//     );
//   } else {
//     cycleReceipts = allIndexedReceipts.filter(
//       (receipt) => Number(receipt.sourceCycle || 0) === cycleNumber
//     );
//   }

//   let cycleEvents;
//   let fallbackMode = false;

//   if (boundary) {
//     cycleEvents = allIndexedEvents.filter(
//       (event) =>
//         event.eventName !== 'OrbitReset' &&
//         isWithinCycleBoundary(event, boundary)
//     );
//   } else {
//     cycleEvents = allIndexedEvents.filter(
//       (event) =>
//         event.eventName !== 'OrbitReset' &&
//         Number(event.cycleNumber || 0) === cycleNumber
//     );
//     fallbackMode = true;
//   }

//   if (cycleEvents.length === 0 && cycleReceipts.length === 0) {
//     const error = new Error(`Cycle ${cycleNumber} is not available yet`);
//     error.status = 404;
//     throw error;
//   }

//   const eventsByPosition = groupByPosition(cycleEvents, 'position');
//   const receiptsByPosition = groupByPosition(cycleReceipts, 'sourcePosition');

//   const positions = [];

//   for (let positionNumber = 1; positionNumber <= totalPositions; positionNumber += 1) {
//     const eventsForPosition = sortByChainPoint(
//       eventsByPosition.get(positionNumber) || []
//     );
//     const receiptsForPosition = sortByChainPoint(
//       receiptsByPosition.get(positionNumber) || []
//     );

//     const latestFill = [...eventsForPosition]
//       .reverse()
//       .find((event) => event.eventName === 'PositionFilled');

//     const receiptSummary = summarizeReceiptsForViewer(
//       receiptsForPosition,
//       normalizedAddress
//     );
//     const ruleView = buildCycleRuleViewFromIndexedEvents(eventsForPosition);
//     const activationId = findActivationIdFromReceipts(receiptsForPosition);

//     positions.push({
//       number: positionNumber,
//       level,
//       cycleNumber,
//       orbitType,
//       line: getLineForPosition(orbitType, positionNumber),
//       parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//       occupant: latestFill?.user || null,
//       amount: latestFill ? formatUsdt(latestFill.amount || '0') : '0.0',
//       timestamp: latestFill ? toSnapshotTimestamp(latestFill.timestamp) : 0,
//       activationId,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//       truthLabel: receiptSummary.truthLabel,
//       indexedEventCount: eventsForPosition.length,
//       indexedReceiptCount: receiptsForPosition.length,
//       receiptTotals: receiptSummary.totals,
//       viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
//       indexedReceipts: shapeIndexedReceipts(receiptsForPosition),
//       indexedEvents: shapeIndexedEvents(eventsForPosition),
//       ruleView,
//     });
//   }

//   const filledPositions = positions.filter((item) => !!item.occupant).length;

//   const update = {
//     address: normalizedAddress,
//     level,
//     cycleNumber,
//     orbitType,
//     filledPositions,
//     totalPositions,
//     positions,
//     metadata: {
//       snapshotVersion: 5,
//       builtFromBlock,
//       builtAt: new Date(),
//       freshnessBlock,
//       completeness: {
//         positionsReady: true,
//         historicalReady: true,
//       },
//       cycleDerivation: {
//         usedResetBoundary: !!boundary,
//         fallbackUsed: fallbackMode,
//         fallbackMode: fallbackMode ? 'event-cycle-number' : 'reset-boundary',
//         previousResetBlock: Number(boundary?.previousReset?.blockNumber || 0),
//         previousResetLogIndex: Number(boundary?.previousReset?.logIndex || 0),
//         currentResetBlock: Number(boundary?.currentReset?.blockNumber || 0),
//         currentResetLogIndex: Number(boundary?.currentReset?.logIndex || 0),
//       },
//     },
//   };

//   const snapshot = await OrbitCycleSnapshot.findOneAndUpdate(
//     { address: normalizedAddress, level, cycleNumber },
//     { $set: update },
//     {
//       upsert: true,
//       returnDocument: 'after',
//       setDefaultsOnInsert: true,
//     }
//   ).lean();

//   logDebug('[ORBIT_CYCLE_SNAPSHOT_BUILT]', {
//     address: normalizedAddress,
//     level,
//     cycleNumber,
//     orbitType,
//     filledPositions,
//     totalPositions,
//     usedResetBoundary: !!boundary,
//     fallbackMode,
//   });

//   return snapshot;
// }














//======================================
// SECOND VERSION
//=======================================
// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';

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

// function getOrbitType(level) {
//   return levelToOrbitType[level];
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

// function shapeIndexedEvents(events) {
//   return events.map((event) => ({
//     txHash: event.txHash,
//     logIndex: event.logIndex,
//     blockNumber: event.blockNumber,
//     eventName: event.eventName,
//     orbitOwner: event.orbitOwner,
//     user: event.user,
//     level: event.level,
//     position: event.position,
//     amount: event.amount,
//     cycleNumber: event.cycleNumber,
//     line: event.line,
//     linePaymentNumber: event.linePaymentNumber,
//     timestamp: event.timestamp,
//     raw: event.raw,
//   }));
// }

// function toSnapshotTimestamp(value) {
//   if (!value) return 0;
//   const ms = new Date(value).getTime();
//   if (!Number.isFinite(ms)) return 0;
//   return Math.floor(ms / 1000);
// }

// function buildCycleRuleViewFromIndexedEvents(eventsForPosition) {
//   const paymentRule = [...eventsForPosition]
//     .reverse()
//     .find((event) => event.eventName === 'PaymentRuleApplied');

//   if (!paymentRule?.raw) return null;

//   return {
//     position: Number(paymentRule.position || 0),
//     line: Number(paymentRule.line || 0),
//     linePaymentNumber: Number(paymentRule.linePaymentNumber || 0),
//     autoUpgradeEnabled: false,
//     isFounderNoReferrerPath: false,
//     hasStoredRuleData: false,
//     toOwner: formatUsdt(paymentRule.raw?.['5'] || '0'),
//     toSpillover1: formatUsdt(paymentRule.raw?.['6'] || '0'),
//     toSpillover2: formatUsdt(paymentRule.raw?.['7'] || '0'),
//     toEscrow: formatUsdt(paymentRule.raw?.['8'] || '0'),
//     toRecycle: formatUsdt(paymentRule.raw?.['9'] || '0'),
//     spillover1Recipient: '',
//     spillover2Recipient: '',
//   };
// }

// function compareChainPoint(aBlock, aLog, bBlock, bLog) {
//   const blockDiff = Number(aBlock || 0) - Number(bBlock || 0);
//   if (blockDiff !== 0) return blockDiff;
//   return Number(aLog || 0) - Number(bLog || 0);
// }

// function sortByChainPoint(items) {
//   return [...items].sort(
//     (a, b) =>
//       compareChainPoint(a.blockNumber, a.logIndex, b.blockNumber, b.logIndex)
//   );
// }

// function getResetEvents(events) {
//   return sortByChainPoint(
//     events.filter((event) => event.eventName === 'OrbitReset')
//   );
// }

// function getCycleBoundary(events, cycleNumber) {
//   const resetEvents = getResetEvents(events);

//   const sortedResets = [...resetEvents].sort((a, b) => {
//     const blockDiff = Number(a.blockNumber || 0) - Number(b.blockNumber || 0);
//     if (blockDiff !== 0) return blockDiff;
//     return Number(a.logIndex || 0) - Number(b.logIndex || 0);
//   });

//   const previousReset = cycleNumber > 1 ? sortedResets[cycleNumber - 2] || null : null;
//   const currentReset = sortedResets[cycleNumber - 1] || null;

//   if (!currentReset) return null;

//   return {
//     previousReset,
//     currentReset,
//   };
// }

// function isWithinCycleBoundary(item, boundary) {
//   if (!boundary?.currentReset) return false;

//   const afterPrevious =
//     !boundary.previousReset ||
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.previousReset.blockNumber,
//       boundary.previousReset.logIndex || 0
//     ) > 0;

//   const beforeCurrent =
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.currentReset.blockNumber,
//       boundary.currentReset.logIndex || 0
//     ) < 0;

//   return afterPrevious && beforeCurrent;
// }



// export async function buildOrbitCycleSnapshot(address, level, cycleNumber, options = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);
//   validateCycleNumber(cycleNumber);

//   const orbitType = getOrbitType(level);
//   const totalPositions = getOrbitPositionCount(orbitType);
//   const builtFromBlock = Number(options.builtFromBlock || 0);
//   const freshnessBlock = Number(options.freshnessBlock || builtFromBlock || 0);

//   const [allIndexedEvents, allIndexedReceipts] = await Promise.all([
//     IndexedOrbitEvent.find({
//       orbitOwner: normalizedAddress,
//       level,
//       orbitType,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),

//     IndexedReceipt.find({
//       orbitOwner: normalizedAddress,
//       level,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),
//   ]);

//   const boundary = getCycleBoundary(allIndexedEvents, cycleNumber);

//   let cycleReceipts;
//   if (boundary) {
//     cycleReceipts = allIndexedReceipts.filter((receipt) =>
//       isWithinCycleBoundary(receipt, boundary)
//     );
//   } else {
//     cycleReceipts = allIndexedReceipts.filter(
//       (receipt) => Number(receipt.sourceCycle || 0) === cycleNumber
//     );
//   }

//   let cycleEvents;
//   let fallbackMode = false;

//     if (boundary) {
//     cycleEvents = allIndexedEvents.filter(
//         (event) =>
//         event.eventName !== 'OrbitReset' &&
//         isWithinCycleBoundary(event, boundary)
//     );
//     } else {
//     cycleEvents = allIndexedEvents.filter(
//         (event) =>
//         event.eventName !== 'OrbitReset' &&
//         Number(event.cycleNumber || 0) === cycleNumber
//     );
//     fallbackMode = true;
//     }

//   if (cycleEvents.length === 0 && cycleReceipts.length === 0) {
//     const error = new Error(`Cycle ${cycleNumber} is not available yet`);
//     error.status = 404;
//     throw error;
//   }

//   const eventsByPosition = new Map();
//   for (const event of cycleEvents) {
//     const pos = Number(event.position || 0);
//     if (pos <= 0) continue;

//     if (!eventsByPosition.has(pos)) {
//       eventsByPosition.set(pos, []);
//     }

//     eventsByPosition.get(pos).push(event);
//   }

//   const receiptsByPosition = new Map();
//   for (const receipt of cycleReceipts) {
//     const pos = Number(receipt.sourcePosition || 0);
//     if (pos <= 0) continue;

//     if (!receiptsByPosition.has(pos)) {
//       receiptsByPosition.set(pos, []);
//     }

//     receiptsByPosition.get(pos).push(receipt);
//   }

//   const positions = [];

//   for (let positionNumber = 1; positionNumber <= totalPositions; positionNumber += 1) {
//     const eventsForPosition = eventsByPosition.get(positionNumber) || [];
//     const receiptsForPosition = receiptsByPosition.get(positionNumber) || [];

//     const latestFill = [...eventsForPosition]
//       .reverse()
//       .find((event) => event.eventName === 'PositionFilled');

//     const receiptSummary = summarizeReceiptsForViewer(receiptsForPosition, normalizedAddress);
//     const ruleView = buildCycleRuleViewFromIndexedEvents(eventsForPosition);

//     positions.push({
//       number: positionNumber,
//       level,
//       cycleNumber,
//       orbitType,
//       line: getLineForPosition(orbitType, positionNumber),
//       parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//       occupant: latestFill?.user || null,
//       amount: latestFill ? formatUsdt(latestFill.amount || '0') : '0.0',
//       timestamp: latestFill ? toSnapshotTimestamp(latestFill.timestamp) : 0,
//       activationId: 0,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//       truthLabel: receiptSummary.truthLabel,
//       indexedEventCount: eventsForPosition.length,
//       indexedReceiptCount: receiptsForPosition.length,
//       receiptTotals: receiptSummary.totals,
//       viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
//       indexedReceipts: shapeIndexedReceipts(receiptsForPosition),
//       indexedEvents: shapeIndexedEvents(eventsForPosition),
//       ruleView,
//     });
//   }

//   const filledPositions = positions.filter((item) => !!item.occupant).length;

//   const update = {
//     address: normalizedAddress,
//     level,
//     cycleNumber,
//     orbitType,
//     filledPositions,
//     totalPositions,
//     positions,
//     metadata: {
//       snapshotVersion: 4,
//       builtFromBlock,
//       builtAt: new Date(),
//       freshnessBlock,
//       completeness: {
//         positionsReady: true,
//         historicalReady: true,
//       },
//       cycleDerivation: {
//         usedResetBoundary: !!boundary,
//         fallbackUsed: fallbackMode,
//         fallbackMode: fallbackMode ? 'event-cycle-number' : 'reset-boundary',
//         },
//     },
//   };

//   const snapshot = await OrbitCycleSnapshot.findOneAndUpdate(
//     { address: normalizedAddress, level, cycleNumber },
//     { $set: update },
//     {
//       upsert: true,
//       returnDocument: 'after',
//       setDefaultsOnInsert: true,
//     }
//   ).lean();

//   return snapshot;
// }













//======================
// FIRST VERSION
//======================
// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import OrbitCycleSnapshot from '../../models/OrbitCycleSnapshot.js';

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

// function getOrbitType(level) {
//   return levelToOrbitType[level];
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

// function shapeIndexedEvents(events) {
//   return events.map((event) => ({
//     txHash: event.txHash,
//     logIndex: event.logIndex,
//     blockNumber: event.blockNumber,
//     eventName: event.eventName,
//     orbitOwner: event.orbitOwner,
//     user: event.user,
//     level: event.level,
//     position: event.position,
//     amount: event.amount,
//     cycleNumber: event.cycleNumber,
//     line: event.line,
//     linePaymentNumber: event.linePaymentNumber,
//     timestamp: event.timestamp,
//     raw: event.raw,
//   }));
// }

// function toSnapshotTimestamp(value) {
//   if (!value) return 0;
//   const ms = new Date(value).getTime();
//   if (!Number.isFinite(ms)) return 0;
//   return Math.floor(ms / 1000);
// }

// function buildCycleRuleViewFromIndexedEvents(eventsForPosition) {
//   const paymentRule = [...eventsForPosition]
//     .reverse()
//     .find((event) => event.eventName === 'PaymentRuleApplied');

//   if (!paymentRule?.raw) return null;

//   return {
//     position: Number(paymentRule.position || 0),
//     line: Number(paymentRule.line || 0),
//     linePaymentNumber: Number(paymentRule.linePaymentNumber || 0),
//     autoUpgradeEnabled: false,
//     isFounderNoReferrerPath: false,
//     hasStoredRuleData: false,
//     toOwner: formatUsdt(paymentRule.raw?.['5'] || '0'),
//     toSpillover1: formatUsdt(paymentRule.raw?.['6'] || '0'),
//     toSpillover2: formatUsdt(paymentRule.raw?.['7'] || '0'),
//     toEscrow: formatUsdt(paymentRule.raw?.['8'] || '0'),
//     toRecycle: formatUsdt(paymentRule.raw?.['9'] || '0'),
//     spillover1Recipient: '',
//     spillover2Recipient: '',
//   };
// }

// function compareChainPoint(aBlock, aLog, bBlock, bLog) {
//   const blockDiff = Number(aBlock || 0) - Number(bBlock || 0);
//   if (blockDiff !== 0) return blockDiff;
//   return Number(aLog || 0) - Number(bLog || 0);
// }

// function sortByChainPoint(items) {
//   return [...items].sort(
//     (a, b) =>
//       compareChainPoint(a.blockNumber, a.logIndex, b.blockNumber, b.logIndex)
//   );
// }

// function getResetEvents(events) {
//   return sortByChainPoint(
//     events.filter((event) => event.eventName === 'OrbitReset')
//   );
// }

// function getCycleBoundary(events, cycleNumber) {
//   const resetEvents = getResetEvents(events);

//   const sortedResets = [...resetEvents].sort((a, b) => {
//     const blockDiff = Number(a.blockNumber || 0) - Number(b.blockNumber || 0);
//     if (blockDiff !== 0) return blockDiff;
//     return Number(a.logIndex || 0) - Number(b.logIndex || 0);
//   });

//   const previousReset = cycleNumber > 1 ? sortedResets[cycleNumber - 2] || null : null;
//   const currentReset = sortedResets[cycleNumber - 1] || null;

//   if (!currentReset) return null;

//   return {
//     previousReset,
//     currentReset,
//   };
// }

// function isWithinCycleBoundary(item, boundary) {
//   if (!boundary?.currentReset) return false;

//   const afterPrevious =
//     !boundary.previousReset ||
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.previousReset.blockNumber,
//       boundary.previousReset.logIndex || 0
//     ) > 0;

//   const beforeCurrent =
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       boundary.currentReset.blockNumber,
//       boundary.currentReset.logIndex || 0
//     ) < 0;

//   return afterPrevious && beforeCurrent;
// }

// function buildFallbackCycleEventsFromReceipts({
//   cycleReceipts,
//   allIndexedEvents,
//   cycleNumber,
// }) {
//   const txHashes = new Set(
//     cycleReceipts
//       .map((receipt) => String(receipt.txHash || '').toLowerCase())
//       .filter(Boolean)
//   );

//   const receiptLinkedEvents = allIndexedEvents.filter((event) => {
//     if (event.eventName === 'OrbitReset') return false;
//     const txHash = String(event.txHash || '').toLowerCase();
//     return txHashes.has(txHash);
//   });

//   if (receiptLinkedEvents.length > 0) {
//     return receiptLinkedEvents;
//   }

//   return allIndexedEvents.filter(
//     (event) =>
//       event.eventName !== 'OrbitReset' &&
//       Number(event.cycleNumber || 0) === cycleNumber
//   );
// }

// export async function buildOrbitCycleSnapshot(address, level, cycleNumber, options = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);
//   validateCycleNumber(cycleNumber);

//   const orbitType = getOrbitType(level);
//   const totalPositions = getOrbitPositionCount(orbitType);
//   const builtFromBlock = Number(options.builtFromBlock || 0);
//   const freshnessBlock = Number(options.freshnessBlock || builtFromBlock || 0);

//   const [allIndexedEvents, allIndexedReceipts] = await Promise.all([
//     IndexedOrbitEvent.find({
//       orbitOwner: normalizedAddress,
//       level,
//       orbitType,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),

//     IndexedReceipt.find({
//       orbitOwner: normalizedAddress,
//       level,
//     })
//       .sort({ blockNumber: 1, logIndex: 1 })
//       .lean(),
//   ]);

//   const boundary = getCycleBoundary(allIndexedEvents, cycleNumber);

//   let cycleReceipts;
//   if (boundary) {
//     cycleReceipts = allIndexedReceipts.filter((receipt) =>
//       isWithinCycleBoundary(receipt, boundary)
//     );
//   } else {
//     cycleReceipts = allIndexedReceipts.filter(
//       (receipt) => Number(receipt.sourceCycle || 0) === cycleNumber
//     );
//   }

//   let cycleEvents;
//   if (boundary) {
//     cycleEvents = allIndexedEvents.filter(
//       (event) =>
//         event.eventName !== 'OrbitReset' &&
//         isWithinCycleBoundary(event, boundary)
//     );
//   } else {
//     cycleEvents = buildFallbackCycleEventsFromReceipts({
//       cycleReceipts,
//       allIndexedEvents,
//       cycleNumber,
//     });
//   }

//   if (cycleEvents.length === 0 && cycleReceipts.length === 0) {
//     const error = new Error(`Cycle ${cycleNumber} is not available yet`);
//     error.status = 404;
//     throw error;
//   }

//   const eventsByPosition = new Map();
//   for (const event of cycleEvents) {
//     const pos = Number(event.position || 0);
//     if (pos <= 0) continue;

//     if (!eventsByPosition.has(pos)) {
//       eventsByPosition.set(pos, []);
//     }

//     eventsByPosition.get(pos).push(event);
//   }

//   const receiptsByPosition = new Map();
//   for (const receipt of cycleReceipts) {
//     const pos = Number(receipt.sourcePosition || 0);
//     if (pos <= 0) continue;

//     if (!receiptsByPosition.has(pos)) {
//       receiptsByPosition.set(pos, []);
//     }

//     receiptsByPosition.get(pos).push(receipt);
//   }

//   const positions = [];

//   for (let positionNumber = 1; positionNumber <= totalPositions; positionNumber += 1) {
//     const eventsForPosition = eventsByPosition.get(positionNumber) || [];
//     const receiptsForPosition = receiptsByPosition.get(positionNumber) || [];

//     const latestFill = [...eventsForPosition]
//       .reverse()
//       .find((event) => event.eventName === 'PositionFilled');

//     const receiptSummary = summarizeReceiptsForViewer(receiptsForPosition, normalizedAddress);
//     const ruleView = buildCycleRuleViewFromIndexedEvents(eventsForPosition);

//     positions.push({
//       number: positionNumber,
//       level,
//       cycleNumber,
//       orbitType,
//       line: getLineForPosition(orbitType, positionNumber),
//       parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//       occupant: latestFill?.user || null,
//       amount: latestFill ? formatUsdt(latestFill.amount || '0') : '0.0',
//       timestamp: latestFill ? toSnapshotTimestamp(latestFill.timestamp) : 0,
//       activationId: 0,
//       activationCycleNumber: cycleNumber,
//       isMirrorActivation: false,
//       truthLabel: receiptSummary.truthLabel,
//       indexedEventCount: eventsForPosition.length,
//       indexedReceiptCount: receiptsForPosition.length,
//       receiptTotals: receiptSummary.totals,
//       viewerReceiptBreakdown: receiptSummary.viewerBreakdown,
//       indexedReceipts: shapeIndexedReceipts(receiptsForPosition),
//       indexedEvents: shapeIndexedEvents(eventsForPosition),
//       ruleView,
//     });
//   }

//   const filledPositions = positions.filter((item) => !!item.occupant).length;

//   const update = {
//     address: normalizedAddress,
//     level,
//     cycleNumber,
//     orbitType,
//     filledPositions,
//     totalPositions,
//     positions,
//     metadata: {
//       snapshotVersion: 3,
//       builtFromBlock,
//       builtAt: new Date(),
//       freshnessBlock,
//       completeness: {
//         positionsReady: true,
//         historicalReady: true,
//       },
//       cycleDerivation: {
//         usedResetBoundary: !!boundary,
//         fallbackUsed: !boundary,
//         receiptLinkedFallbackUsed: !boundary,
//       },
//     },
//   };

//   const snapshot = await OrbitCycleSnapshot.findOneAndUpdate(
//     { address: normalizedAddress, level, cycleNumber },
//     { $set: update },
//     {
//       upsert: true,
//       returnDocument: 'after',
//       setDefaultsOnInsert: true,
//     }
//   ).lean();

//   return snapshot;
// }
