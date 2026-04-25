import { ethers } from 'ethers';
import IndexedReceipt from '../../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
import { enrichOrbitLevelSnapshot } from './orbitLevelSnapshotEnricher.js';
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

function toSnapshotTimestamp(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function buildEmptyPosition(orbitType, positionNumber, currentCycleNumber) {
  return {
    number: positionNumber,
    line: getLineForPosition(orbitType, positionNumber),
    parentPosition: getStructuralParentPosition(orbitType, positionNumber),
    occupant: null,
    amount: '0.0',
    timestamp: 0,
    activationId: 0,
    activationCycleNumber: currentCycleNumber,
    isMirrorActivation: false,
    truthLabel: 'NO_RECEIPT',
    indexedEventCount: 0,
    indexedReceiptCount: 0,
    receiptTotals: buildEmptyReceiptTotals(),
    viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
  };
}

function groupEventsByPosition(events) {
  const byPosition = new Map();

  for (const event of events) {
    const pos = Number(event.position || 0);
    if (pos <= 0) continue;

    if (!byPosition.has(pos)) {
      byPosition.set(pos, []);
    }

    byPosition.get(pos).push(event);
  }

  return byPosition;
}

function groupReceiptsByPosition(receipts) {
  const byPosition = new Map();

  for (const receipt of receipts) {
    const pos = Number(receipt.sourcePosition || 0);
    if (pos <= 0) continue;

    if (!byPosition.has(pos)) {
      byPosition.set(pos, []);
    }

    byPosition.get(pos).push(receipt);
  }

  return byPosition;
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

function getCompletedCycleCount(resetEvents) {
  if (!resetEvents.length) return 0;

  return Math.max(
    ...resetEvents.map((event) => Number(event.cycleNumber || 0))
  );
}

function isAfterResetBoundary(item, resetEvent) {
  if (!resetEvent) return true;

  return (
    compareChainPoint(
      item.blockNumber,
      item.logIndex || 0,
      resetEvent.blockNumber,
      resetEvent.logIndex || 0
    ) > 0
  );
}

function getCurrentCycleEvents(allEvents, totalCycles) {
  const sorted = sortByChainPoint(allEvents);
  const resetEvents = getResetEvents(sorted);
  const lastReset = resetEvents.length ? resetEvents[resetEvents.length - 1] : null;

  const currentCycleNumber = Number(totalCycles || 0) + 1;

  const eventsAfterReset = sorted.filter(
    (event) =>
      event.eventName !== 'OrbitReset' &&
      isAfterResetBoundary(event, lastReset)
  );

  if (eventsAfterReset.length > 0) {
    return {
      currentEvents: eventsAfterReset,
      lastReset,
      resetEvents,
      currentCycleNumber,
      source: 'reset-boundary',
    };
  }

  const cycleTaggedEvents = sorted.filter(
    (event) =>
      event.eventName !== 'OrbitReset' &&
      Number(event.cycleNumber || 0) === currentCycleNumber
  );

  return {
    currentEvents: cycleTaggedEvents,
    lastReset,
    resetEvents,
    currentCycleNumber,
    source: 'event-cycle-number',
  };
}

function getCurrentCycleReceipts(allReceipts, lastReset, currentCycleNumber) {
  const cycleTaggedReceipts = allReceipts.filter(
    (receipt) =>
      Number(receipt.sourceCycle || 0) === Number(currentCycleNumber || 0)
  );

  if (cycleTaggedReceipts.length > 0) {
    return cycleTaggedReceipts;
  }

  if (!lastReset) return allReceipts;

  return allReceipts.filter(
    (receipt) =>
      compareChainPoint(
        receipt.blockNumber,
        receipt.logIndex || 0,
        lastReset.blockNumber,
        lastReset.logIndex || 0
      ) > 0
  );
}

function buildLinePaymentCountsFromEvents(events) {
  const counts = {
    line1: 0,
    line2: 0,
    line3: 0,
  };

  const lineTrackedEvents = events.filter(
    (event) => event.eventName === 'LinePaymentTracked'
  );

  for (const event of lineTrackedEvents) {
    const line = Number(event.line || 0);
    const paymentNumber = Number(event.linePaymentNumber || 0);

    if (line === 1) {
      counts.line1 = Math.max(counts.line1, paymentNumber);
    } else if (line === 2) {
      counts.line2 = Math.max(counts.line2, paymentNumber);
    } else if (line === 3) {
      counts.line3 = Math.max(counts.line3, paymentNumber);
    }
  }

  return counts;
}

function buildPositionFromIndexedData({
  orbitType,
  positionNumber,
  eventsForPosition,
  receiptsForPosition,
  normalizedAddress,
  currentCycleNumber,
}) {
  const snapshot = buildEmptyPosition(
    orbitType,
    positionNumber,
    currentCycleNumber
  );

  const sortedEvents = sortByChainPoint(eventsForPosition);
  const fillEvents = sortedEvents.filter(
    (event) => event.eventName === 'PositionFilled'
  );
  const latestFill = fillEvents.length ? fillEvents[fillEvents.length - 1] : null;

  if (latestFill) {
    snapshot.occupant = latestFill.user || null;
    snapshot.amount = formatUsdt(latestFill.amount || '0');
    snapshot.timestamp = toSnapshotTimestamp(latestFill.timestamp);
    snapshot.activationId = Number(latestFill.raw?.activationId || 0);
  }

  snapshot.indexedEventCount = sortedEvents.length;
  snapshot.indexedReceiptCount = receiptsForPosition.length;

  const receiptSummary = summarizeReceiptsForViewer(
    receiptsForPosition,
    normalizedAddress
  );

  snapshot.truthLabel = receiptSummary.truthLabel;
  snapshot.receiptTotals = receiptSummary.totals;
  snapshot.viewerReceiptBreakdown = receiptSummary.viewerBreakdown;

  if (snapshot.activationId === 0) {
    const firstActivationId = receiptsForPosition.find(
      (receipt) => Number(receipt.activationId || 0) > 0
    );
    snapshot.activationId = firstActivationId
      ? Number(firstActivationId.activationId || 0)
      : 0;
  }

  return snapshot;
}

function countFilledPositions(positions = []) {
  return positions.filter((position) => !!position?.occupant).length;
}

// function shouldPreserveExistingSnapshot({
//   existingSnapshot,
//   rebuiltPositions,
//   currentEvents,
//   currentReceipts,
// }) {
//   if (!existingSnapshot?.positions?.length) return false;

//   const existingFilled = countFilledPositions(existingSnapshot.positions);
//   const rebuiltFilled = countFilledPositions(rebuiltPositions);

//   if (existingFilled === 0) return false;

//   if (rebuiltFilled >= existingFilled) return false;

//   const rebuiltHasNoSignal =
//     (currentEvents?.length || 0) === 0 &&
//     (currentReceipts?.length || 0) === 0;

//   if (rebuiltHasNoSignal) return true;

//   if (rebuiltFilled === 0 && existingFilled > 0) return true;

//   return false;
// }

function shouldPreserveExistingSnapshot({
  existingSnapshot,
  rebuiltPositions,
  currentEvents,
  currentReceipts,
}) {
  if (!existingSnapshot?.positions?.length) return false;

  const existingFilled = countFilledPositions(existingSnapshot.positions);
  const rebuiltFilled = countFilledPositions(rebuiltPositions);
  const totalPositions = rebuiltPositions.length;

  if (existingFilled === 0) return false;

  // Never preserve old snapshot when rebuild is equal or better
  if (rebuiltFilled >= existingFilled) return false;

  // Never preserve old snapshot when rebuild shows a fully completed orbit
  if (rebuiltFilled === totalPositions && totalPositions > 0) return false;

  const rebuiltHasNoSignal =
    (currentEvents?.length || 0) === 0 &&
    (currentReceipts?.length || 0) === 0;

  if (rebuiltHasNoSignal) return true;

  if (rebuiltFilled === 0 && existingFilled > 0) return true;

  return false;
}

function preserveExistingSnapshotShape({
  existingSnapshot,
  rebuiltPositions,
  currentCycleNumber,
  totalCycles,
  linePaymentCounts,
}) {
  const existingPositions = Array.isArray(existingSnapshot?.positions)
    ? existingSnapshot.positions
    : [];

  const existingOrbitSummary = existingSnapshot?.orbitSummary || {};
  const existingLinePaymentCounts = existingSnapshot?.linePaymentCounts || {};

  return {
    positions: existingPositions.map((position) => ({
      ...position,
      activationCycleNumber:
        Number(position?.activationCycleNumber || 0) || currentCycleNumber,
    })),
    orbitSummary: {
      currentPosition:
        Number(existingOrbitSummary.currentPosition || 0) ||
        Number(rebuiltPositions.filter((p) => !!p.occupant).length + 1),
      escrowBalance: String(existingOrbitSummary.escrowBalance || '0'),
      autoUpgradeCompleted: Boolean(
        existingOrbitSummary.autoUpgradeCompleted || false
      ),
      positionsInLine1: Number(existingOrbitSummary.positionsInLine1 || 0),
      positionsInLine2: Number(existingOrbitSummary.positionsInLine2 || 0),
      positionsInLine3: Number(existingOrbitSummary.positionsInLine3 || 0),
      totalCycles: Math.max(
        Number(existingOrbitSummary.totalCycles || 0),
        Number(totalCycles || 0)
      ),
      totalEarned: String(existingOrbitSummary.totalEarned || '0'),
    },
    linePaymentCounts: {
      line1: Math.max(
        Number(existingLinePaymentCounts.line1 || 0),
        Number(linePaymentCounts.line1 || 0)
      ),
      line2: Math.max(
        Number(existingLinePaymentCounts.line2 || 0),
        Number(linePaymentCounts.line2 || 0)
      ),
      line3: Math.max(
        Number(existingLinePaymentCounts.line3 || 0),
        Number(linePaymentCounts.line3 || 0)
      ),
    },
  };
}

export async function buildOrbitLevelSnapshot(address, level, options = {}) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);

  const orbitType = getOrbitType(level);
  if (!orbitType) {
    const error = new Error(`Unsupported level ${level}`);
    error.status = 400;
    throw error;
  }

  const positionsCount = getOrbitPositionCount(orbitType);
  const builtFromBlock = Number(options.builtFromBlock || 0);
  const freshnessBlock = Number(options.freshnessBlock || builtFromBlock || 0);

  const [existingSnapshot, allIndexedEvents, allIndexedReceipts] = await Promise.all([
    OrbitLevelSnapshot.findOne({
      address: normalizedAddress,
      level,
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

  const resetEvents = getResetEvents(allIndexedEvents);
  const totalCycles = getCompletedCycleCount(resetEvents);

  const {
    currentEvents,
    lastReset,
    currentCycleNumber,
    source: cycleSource,
  } = getCurrentCycleEvents(allIndexedEvents, totalCycles);

  const currentReceipts = getCurrentCycleReceipts(
    allIndexedReceipts,
    lastReset,
    currentCycleNumber
  );

  const eventsByPosition = groupEventsByPosition(currentEvents);
  const receiptsByPosition = groupReceiptsByPosition(currentReceipts);

  let positions = [];
  for (let positionNumber = 1; positionNumber <= positionsCount; positionNumber += 1) {
    const eventsForPosition = eventsByPosition.get(positionNumber) || [];
    const receiptsForPosition = receiptsByPosition.get(positionNumber) || [];

    positions.push(
      buildPositionFromIndexedData({
        orbitType,
        positionNumber,
        eventsForPosition,
        receiptsForPosition,
        normalizedAddress,
        currentCycleNumber,
      })
    );
  }

  let linePaymentCounts = buildLinePaymentCountsFromEvents(currentEvents);
  let preservedFromExisting = false;

  if (
    shouldPreserveExistingSnapshot({
      existingSnapshot,
      rebuiltPositions: positions,
      currentEvents,
      currentReceipts,
    })
  ) {
    const preserved = preserveExistingSnapshotShape({
      existingSnapshot,
      rebuiltPositions: positions,
      currentCycleNumber,
      totalCycles,
      linePaymentCounts,
    });

    positions = preserved.positions;
    linePaymentCounts = preserved.linePaymentCounts;
    preservedFromExisting = true;

    logDebug('[ORBIT_LEVEL_SNAPSHOT_PRESERVED_EXISTING]', {
      address: normalizedAddress,
      level,
      orbitType,
      rebuiltFilled: countFilledPositions(positions),
      existingFilled: countFilledPositions(existingSnapshot?.positions || []),
      currentEvents: currentEvents.length,
      currentReceipts: currentReceipts.length,
    });
  }

  // const filledCurrentPositions = countFilledPositions(positions);
  // const currentPosition =
  //   filledCurrentPositions >= positionsCount
  //     ? positionsCount
  //     : filledCurrentPositions + 1;


  const filledCurrentPositions = countFilledPositions(positions);
  const currentPosition =
  filledCurrentPositions >= positionsCount
    ? 0
    : filledCurrentPositions + 1;

    logDebug('[CURRENT_CYCLE_POSITION_CHECK]', {
    address: normalizedAddress,
    level,
    orbitType,
    filledCurrentPositions,
    positionsCount,
    totalCycles,
    currentCycleNumber,
  });

  const positionsInLine1 = positions.filter(
    (p) => p.line === 1 && p.occupant
  ).length;
  const positionsInLine2 = positions.filter(
    (p) => p.line === 2 && p.occupant
  ).length;
  const positionsInLine3 = positions.filter(
    (p) => p.line === 3 && p.occupant
  ).length;

  const update = {
    address: normalizedAddress,
    level,
    orbitType,

    isLevelActive: Boolean(existingSnapshot?.isLevelActive || false),
    orbitSummary: {
      currentPosition,
      escrowBalance: String(existingSnapshot?.orbitSummary?.escrowBalance || '0'),
      autoUpgradeCompleted: Boolean(
        existingSnapshot?.orbitSummary?.autoUpgradeCompleted || false
      ),
      positionsInLine1,
      positionsInLine2,
      positionsInLine3,
      totalCycles: Math.max(
        Number(existingSnapshot?.orbitSummary?.totalCycles || 0),
        Number(totalCycles || 0)
      ),
      totalEarned: String(existingSnapshot?.orbitSummary?.totalEarned || '0'),
    },
    linePaymentCounts,
    lockedForNextLevel: String(existingSnapshot?.lockedForNextLevel || '0'),

    positions,

    metadata: {
      snapshotVersion: 4,
      builtFromBlock,
      builtAt: new Date(),
      enrichedAt: null,
      freshnessBlock,
      completeness: {
        positionsReady: true,
        summaryReady: false,
        activationFlagsReady: true,
      },
      cycleDerivation: {
        totalCycles: Math.max(
          Number(existingSnapshot?.metadata?.cycleDerivation?.totalCycles || 0),
          Number(totalCycles || 0)
        ),
        currentCycleNumber,
        currentCycleSource: cycleSource,
        resetBoundaryBlock: Number(lastReset?.blockNumber || 0),
        resetBoundaryLogIndex: Number(lastReset?.logIndex || 0),
        preservedFromExisting,
      },
    },
  };

  await OrbitLevelSnapshot.findOneAndUpdate(
    { address: normalizedAddress, level },
    { $set: update },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    }
  ).lean();

  logDebug('[ORBIT_LEVEL_SNAPSHOT_BUILT]', {
    address: normalizedAddress,
    level,
    orbitType,
    totalCycles,
    currentCycleNumber,
    cycleSource,
    currentPosition,
    positionsCount,
    positionsInLine1,
    positionsInLine2,
    positionsInLine3,
    linePaymentCounts,
    preservedFromExisting,
    currentEventsCount: currentEvents.length,
    currentReceiptsCount: currentReceipts.length,
  });

  await enrichOrbitLevelSnapshot(normalizedAddress, level);

  const enrichedSnapshot = await OrbitLevelSnapshot.findOne({
    address: normalizedAddress,
    level,
  }).lean();

  if (!enrichedSnapshot) {
    const error = new Error('Failed to build orbit level snapshot');
    error.status = 500;
    throw error;
  }

  return enrichedSnapshot;
}








//==========================
// SECOND VERSION
//==========================
// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
// import { enrichOrbitLevelSnapshot } from './orbitLevelSnapshotEnricher.js';
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

// function toSnapshotTimestamp(value) {
//   if (!value) return 0;
//   const ms = new Date(value).getTime();
//   if (!Number.isFinite(ms)) return 0;
//   return Math.floor(ms / 1000);
// }

// function buildEmptyPosition(orbitType, positionNumber, currentCycleNumber) {
//   return {
//     number: positionNumber,
//     line: getLineForPosition(orbitType, positionNumber),
//     parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//     occupant: null,
//     amount: '0.0',
//     timestamp: 0,
//     activationId: 0,
//     activationCycleNumber: currentCycleNumber,
//     isMirrorActivation: false,
//     truthLabel: 'NO_RECEIPT',
//     indexedEventCount: 0,
//     indexedReceiptCount: 0,
//     receiptTotals: buildEmptyReceiptTotals(),
//     viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
//   };
// }

// function groupEventsByPosition(events) {
//   const byPosition = new Map();

//   for (const event of events) {
//     const pos = Number(event.position || 0);
//     if (pos <= 0) continue;

//     if (!byPosition.has(pos)) {
//       byPosition.set(pos, []);
//     }

//     byPosition.get(pos).push(event);
//   }

//   return byPosition;
// }

// function groupReceiptsByPosition(receipts) {
//   const byPosition = new Map();

//   for (const receipt of receipts) {
//     const pos = Number(receipt.sourcePosition || 0);
//     if (pos <= 0) continue;

//     if (!byPosition.has(pos)) {
//       byPosition.set(pos, []);
//     }

//     byPosition.get(pos).push(receipt);
//   }

//   return byPosition;
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

// function getCompletedCycleCount(resetEvents) {
//   if (!resetEvents.length) return 0;

//   return Math.max(
//     ...resetEvents.map((event) => Number(event.cycleNumber || 0))
//   );
// }

// function isAfterResetBoundary(item, resetEvent) {
//   if (!resetEvent) return true;

//   return (
//     compareChainPoint(
//       item.blockNumber,
//       item.logIndex || 0,
//       resetEvent.blockNumber,
//       resetEvent.logIndex || 0
//     ) > 0
//   );
// }

// function getCurrentCycleEvents(allEvents, totalCycles) {
//   const sorted = sortByChainPoint(allEvents);
//   const resetEvents = getResetEvents(sorted);
//   const lastReset = resetEvents.length ? resetEvents[resetEvents.length - 1] : null;

//   const currentCycleNumber = Number(totalCycles || 0) + 1;

//   const eventsAfterReset = sorted.filter(
//     (event) =>
//       event.eventName !== 'OrbitReset' &&
//       isAfterResetBoundary(event, lastReset)
//   );

//   if (eventsAfterReset.length > 0) {
//     return {
//       currentEvents: eventsAfterReset,
//       lastReset,
//       resetEvents,
//       currentCycleNumber,
//       source: 'reset-boundary',
//     };
//   }

//   const cycleTaggedEvents = sorted.filter(
//     (event) =>
//       event.eventName !== 'OrbitReset' &&
//       Number(event.cycleNumber || 0) === currentCycleNumber
//   );

//   return {
//     currentEvents: cycleTaggedEvents,
//     lastReset,
//     resetEvents,
//     currentCycleNumber,
//     source: 'event-cycle-number',
//   };
// }

// function getCurrentCycleReceipts(allReceipts, lastReset, currentCycleNumber) {
//   const cycleTaggedReceipts = allReceipts.filter(
//     (receipt) =>
//       Number(receipt.sourceCycle || 0) === Number(currentCycleNumber || 0)
//   );

//   if (cycleTaggedReceipts.length > 0) {
//     return cycleTaggedReceipts;
//   }

//   if (!lastReset) return allReceipts;

//   return allReceipts.filter(
//     (receipt) =>
//       compareChainPoint(
//         receipt.blockNumber,
//         receipt.logIndex || 0,
//         lastReset.blockNumber,
//         lastReset.logIndex || 0
//       ) > 0
//   );
// }

// function buildLinePaymentCountsFromEvents(events) {
//   const counts = {
//     line1: 0,
//     line2: 0,
//     line3: 0,
//   };

//   const lineTrackedEvents = events.filter(
//     (event) => event.eventName === 'LinePaymentTracked'
//   );

//   for (const event of lineTrackedEvents) {
//     const line = Number(event.line || 0);
//     const paymentNumber = Number(event.linePaymentNumber || 0);

//     if (line === 1) {
//       counts.line1 = Math.max(counts.line1, paymentNumber);
//     } else if (line === 2) {
//       counts.line2 = Math.max(counts.line2, paymentNumber);
//     } else if (line === 3) {
//       counts.line3 = Math.max(counts.line3, paymentNumber);
//     }
//   }

//   return counts;
// }

// function buildPositionFromIndexedData({
//   orbitType,
//   positionNumber,
//   eventsForPosition,
//   receiptsForPosition,
//   normalizedAddress,
//   currentCycleNumber,
// }) {
//   const snapshot = buildEmptyPosition(
//     orbitType,
//     positionNumber,
//     currentCycleNumber
//   );

//   const sortedEvents = sortByChainPoint(eventsForPosition);
//   const fillEvents = sortedEvents.filter(
//     (event) => event.eventName === 'PositionFilled'
//   );
//   const latestFill = fillEvents.length ? fillEvents[fillEvents.length - 1] : null;

//   if (latestFill) {
//     snapshot.occupant = latestFill.user || null;
//     snapshot.amount = formatUsdt(latestFill.amount || '0');
//     snapshot.timestamp = toSnapshotTimestamp(latestFill.timestamp);
//     snapshot.activationId = Number(latestFill.raw?.activationId || 0);
//   }

//   snapshot.indexedEventCount = sortedEvents.length;
//   snapshot.indexedReceiptCount = receiptsForPosition.length;

//   const receiptSummary = summarizeReceiptsForViewer(
//     receiptsForPosition,
//     normalizedAddress
//   );

//   snapshot.truthLabel = receiptSummary.truthLabel;
//   snapshot.receiptTotals = receiptSummary.totals;
//   snapshot.viewerReceiptBreakdown = receiptSummary.viewerBreakdown;

//   if (snapshot.activationId === 0) {
//     const firstActivationId = receiptsForPosition.find(
//       (receipt) => Number(receipt.activationId || 0) > 0
//     );
//     snapshot.activationId = firstActivationId
//       ? Number(firstActivationId.activationId || 0)
//       : 0;
//   }

//   return snapshot;
// }

// export async function buildOrbitLevelSnapshot(address, level, options = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);

//   const orbitType = getOrbitType(level);
//   if (!orbitType) {
//     const error = new Error(`Unsupported level ${level}`);
//     error.status = 400;
//     throw error;
//   }

//   const positionsCount = getOrbitPositionCount(orbitType);
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

//   const resetEvents = getResetEvents(allIndexedEvents);
//   const totalCycles = getCompletedCycleCount(resetEvents);

//   const {
//     currentEvents,
//     lastReset,
//     currentCycleNumber,
//     source: cycleSource,
//   } = getCurrentCycleEvents(allIndexedEvents, totalCycles);

//   const currentReceipts = getCurrentCycleReceipts(
//     allIndexedReceipts,
//     lastReset,
//     currentCycleNumber
//   );

//   const eventsByPosition = groupEventsByPosition(currentEvents);
//   const receiptsByPosition = groupReceiptsByPosition(currentReceipts);

//   const positions = [];
//   for (let positionNumber = 1; positionNumber <= positionsCount; positionNumber += 1) {
//     const eventsForPosition = eventsByPosition.get(positionNumber) || [];
//     const receiptsForPosition = receiptsByPosition.get(positionNumber) || [];

//     positions.push(
//       buildPositionFromIndexedData({
//         orbitType,
//         positionNumber,
//         eventsForPosition,
//         receiptsForPosition,
//         normalizedAddress,
//         currentCycleNumber,
//       })
//     );
//   }

//   const filledCurrentPositions = positions.filter((p) => !!p.occupant).length;
//   const currentPosition =
//     filledCurrentPositions >= positionsCount
//       ? positionsCount
//       : filledCurrentPositions + 1;

//   const positionsInLine1 = positions.filter(
//     (p) => p.line === 1 && p.occupant
//   ).length;
//   const positionsInLine2 = positions.filter(
//     (p) => p.line === 2 && p.occupant
//   ).length;
//   const positionsInLine3 = positions.filter(
//     (p) => p.line === 3 && p.occupant
//   ).length;

//   const linePaymentCounts = buildLinePaymentCountsFromEvents(currentEvents);

//   const update = {
//     address: normalizedAddress,
//     level,
//     orbitType,

//     isLevelActive: false,
//     orbitSummary: {
//       currentPosition,
//       escrowBalance: '0',
//       autoUpgradeCompleted: false,
//       positionsInLine1,
//       positionsInLine2,
//       positionsInLine3,
//       totalCycles,
//       totalEarned: '0',
//     },
//     linePaymentCounts,
//     lockedForNextLevel: '0',

//     positions,

//     metadata: {
//       snapshotVersion: 3,
//       builtFromBlock,
//       builtAt: new Date(),
//       enrichedAt: null,
//       freshnessBlock,
//       completeness: {
//         positionsReady: true,
//         summaryReady: false,
//         activationFlagsReady: true,
//       },
//       cycleDerivation: {
//         totalCycles,
//         currentCycleNumber,
//         currentCycleSource: cycleSource,
//         resetBoundaryBlock: Number(lastReset?.blockNumber || 0),
//         resetBoundaryLogIndex: Number(lastReset?.logIndex || 0),
//       },
//     },
//   };

//   await OrbitLevelSnapshot.findOneAndUpdate(
//     { address: normalizedAddress, level },
//     { $set: update },
//     {
//       upsert: true,
//       returnDocument: 'after',
//       setDefaultsOnInsert: true,
//     }
//   ).lean();

//   logDebug('[ORBIT_LEVEL_SNAPSHOT_BUILT]', {
//     address: normalizedAddress,
//     level,
//     orbitType,
//     totalCycles,
//     currentCycleNumber,
//     cycleSource,
//     currentPosition,
//     positionsCount,
//     positionsInLine1,
//     positionsInLine2,
//     positionsInLine3,
//     linePaymentCounts,
//   });

//   await enrichOrbitLevelSnapshot(normalizedAddress, level);

//   const enrichedSnapshot = await OrbitLevelSnapshot.findOne({
//     address: normalizedAddress,
//     level,
//   }).lean();

//   if (!enrichedSnapshot) {
//     const error = new Error('Failed to build orbit level snapshot');
//     error.status = 500;
//     throw error;
//   }

//   return enrichedSnapshot;
// }













//=========================
// FIRST VERSION
//===========================
// import { ethers } from 'ethers';
// import IndexedReceipt from '../../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';
// import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
// import { enrichOrbitLevelSnapshot } from './orbitLevelSnapshotEnricher.js';

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

// function toSnapshotTimestamp(value) {
//   if (!value) return 0;
//   const ms = new Date(value).getTime();
//   if (!Number.isFinite(ms)) return 0;
//   return Math.floor(ms / 1000);
// }

// function buildEmptyPosition(orbitType, positionNumber) {
//   return {
//     number: positionNumber,
//     line: getLineForPosition(orbitType, positionNumber),
//     parentPosition: getStructuralParentPosition(orbitType, positionNumber),
//     occupant: null,
//     amount: '0.0',
//     timestamp: 0,
//     activationId: 0,
//     activationCycleNumber: 0,
//     isMirrorActivation: false,
//     truthLabel: 'NO_RECEIPT',
//     indexedEventCount: 0,
//     indexedReceiptCount: 0,
//     receiptTotals: buildEmptyReceiptTotals(),
//     viewerReceiptBreakdown: buildEmptyViewerBreakdown(),
//   };
// }

// function groupEventsByPosition(events) {
//   const byPosition = new Map();

//   for (const event of events) {
//     const pos = Number(event.position || 0);
//     if (pos <= 0) continue;

//     if (!byPosition.has(pos)) {
//       byPosition.set(pos, []);
//     }

//     byPosition.get(pos).push(event);
//   }

//   return byPosition;
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

// function getCompletedCycleCount(resetEvents) {
//   if (!resetEvents.length) return 0;

//   return Math.max(
//     ...resetEvents.map((event) => Number(event.cycleNumber || 0))
//   );
// }

// function isAfterResetBoundary(item, resetEvent) {
//   if (!resetEvent) return true;
//   return compareChainPoint(
//     item.blockNumber,
//     item.logIndex || 0,
//     resetEvent.blockNumber,
//     resetEvent.logIndex || 0
//   ) > 0;
// }

// function getCurrentCycleEvents(allEvents, totalCycles) {
//   const sorted = sortByChainPoint(allEvents);
//   const resetEvents = getResetEvents(sorted);
//   const lastReset = resetEvents.length ? resetEvents[resetEvents.length - 1] : null;

//   const currentCycleNumber = Number(totalCycles || 0) + 1;

//   // ALWAYS use reset boundary first (ground truth)
//   const eventsAfterReset = sorted.filter(
//     (event) =>
//       event.eventName !== 'OrbitReset' &&
//       isAfterResetBoundary(event, lastReset)
//   );

//   if (eventsAfterReset.length > 0) {
//     return {
//       currentEvents: eventsAfterReset,
//       lastReset,
//       resetEvents,
//       currentCycleNumber,
//       source: 'reset-boundary',
//     };
//   }

//   // fallback only if reset-based fails
//   const cycleTaggedEvents = sorted.filter(
//     (event) =>
//       event.eventName !== 'OrbitReset' &&
//       Number(event.cycleNumber || 0) === currentCycleNumber
//   );

//   return {
//     currentEvents: cycleTaggedEvents,
//     lastReset,
//     resetEvents,
//     currentCycleNumber,
//     source: 'event-cycle-number',
//   };
// }

// function getCurrentCycleReceipts(allReceipts, lastReset, currentCycleNumber) {
//   const cycleTaggedReceipts = allReceipts.filter(
//     (receipt) => Number(receipt.sourceCycle || 0) === Number(currentCycleNumber || 0)
//   );

//   if (cycleTaggedReceipts.length > 0) {
//     return cycleTaggedReceipts;
//   }

//   if (!lastReset) return allReceipts;

//   return allReceipts.filter((receipt) =>
//     compareChainPoint(
//       receipt.blockNumber,
//       receipt.logIndex || 0,
//       lastReset.blockNumber,
//       lastReset.logIndex || 0
//     ) > 0
//   );
// }

// function buildPositionFromIndexedData({
//   orbitType,
//   positionNumber,
//   eventsForPosition,
//   receiptsForPosition,
//   normalizedAddress,
//   currentCycleNumber,
// }) {
//   const snapshot = buildEmptyPosition(orbitType, positionNumber);

//   const sortedEvents = [...eventsForPosition].sort(
//     (a, b) =>
//       Number(a.blockNumber || 0) - Number(b.blockNumber || 0) ||
//       Number(a.logIndex || 0) - Number(b.logIndex || 0)
//   );

//   const fillEvents = sortedEvents.filter((e) => e.eventName === 'PositionFilled');
//   const latestFill = fillEvents.length ? fillEvents[fillEvents.length - 1] : null;

//   if (latestFill) {
//     snapshot.occupant = latestFill.user || null;
//     snapshot.amount = formatUsdt(latestFill.amount || '0');
//     snapshot.timestamp = toSnapshotTimestamp(latestFill.timestamp);
//   }

//   snapshot.indexedEventCount = sortedEvents.length;
//   snapshot.indexedReceiptCount = receiptsForPosition.length;

//   const receiptSummary = summarizeReceiptsForViewer(receiptsForPosition, normalizedAddress);
//   snapshot.truthLabel = receiptSummary.truthLabel;
//   snapshot.receiptTotals = receiptSummary.totals;
//   snapshot.viewerReceiptBreakdown = receiptSummary.viewerBreakdown;

//   snapshot.activationId = 0;
//   snapshot.activationCycleNumber = currentCycleNumber;
//   snapshot.isMirrorActivation = false;

//   return snapshot;
// }

// export async function buildOrbitLevelSnapshot(address, level, options = {}) {
//   const normalizedAddress = normalizeAddress(address);
//   validateLevel(level);

//   const orbitType = getOrbitType(level);
//   const positionsCount = getOrbitPositionCount(orbitType);
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

//   const resetEvents = getResetEvents(allIndexedEvents);
//   const totalCycles = getCompletedCycleCount(resetEvents);

//   const {
//     currentEvents,
//     lastReset,
//     currentCycleNumber,
//   } = getCurrentCycleEvents(allIndexedEvents, totalCycles);

//   const currentReceipts = getCurrentCycleReceipts(
//     allIndexedReceipts,
//     lastReset,
//     currentCycleNumber
//   );

//   const eventsByPosition = groupEventsByPosition(currentEvents);

//   const receiptsByPosition = new Map();
//   for (const receipt of currentReceipts) {
//     const pos = Number(receipt.sourcePosition || 0);
//     if (pos <= 0) continue;

//     if (!receiptsByPosition.has(pos)) {
//       receiptsByPosition.set(pos, []);
//     }

//     receiptsByPosition.get(pos).push(receipt);
//   }

//   const positions = [];
//   for (let positionNumber = 1; positionNumber <= positionsCount; positionNumber += 1) {
//     const eventsForPosition = eventsByPosition.get(positionNumber) || [];
//     const receiptsForPosition = receiptsByPosition.get(positionNumber) || [];

//     positions.push(
//       buildPositionFromIndexedData({
//         orbitType,
//         positionNumber,
//         eventsForPosition,
//         receiptsForPosition,
//         normalizedAddress,
//         currentCycleNumber,
//       })
//     );
//   }

//   let currentPosition = 1;
//   if (positions.some((p) => p.occupant)) {
//     const filledCurrentPositions = positions.filter((p) => !!p.occupant).length;
//     currentPosition = Math.min(filledCurrentPositions + 1, positionsCount);
//   }

//   const positionsInLine1 = positions.filter((p) => p.line === 1 && p.occupant).length;
//   const positionsInLine2 = positions.filter((p) => p.line === 2 && p.occupant).length;
//   const positionsInLine3 = positions.filter((p) => p.line === 3 && p.occupant).length;

//   const update = {
//     address: normalizedAddress,
//     level,
//     orbitType,

//     isLevelActive: false,
//     orbitSummary: {
//       currentPosition,
//       escrowBalance: '0',
//       autoUpgradeCompleted: false,
//       positionsInLine1,
//       positionsInLine2,
//       positionsInLine3,
//       totalCycles,
//       totalEarned: '0',
//     },
//     linePaymentCounts: {
//       line1: 0,
//       line2: 0,
//       line3: 0,
//     },
//     lockedForNextLevel: '0',

//     positions,

//     metadata: {
//       snapshotVersion: 2,
//       builtFromBlock,
//       builtAt: new Date(),
//       enrichedAt: null,
//       freshnessBlock,
//       completeness: {
//         positionsReady: true,
//         summaryReady: false,
//         activationFlagsReady: false,
//       },
//       cycleDerivation: {
//         totalCycles,
//         currentCycleNumber,
//       },
//     },
//   };

//   await OrbitLevelSnapshot.findOneAndUpdate(
//     { address: normalizedAddress, level },
//     { $set: update },
//     {
//       upsert: true,
//       returnDocument: 'after',
//       setDefaultsOnInsert: true,
//     }
//   ).lean();

//   await enrichOrbitLevelSnapshot(normalizedAddress, level);

//   const enrichedSnapshot = await OrbitLevelSnapshot.findOne({
//     address: normalizedAddress,
//     level,
//   }).lean();

//   if (!enrichedSnapshot) {
//     const error = new Error('Failed to build orbit level snapshot');
//     error.status = 500;
//     throw error;
//   }

//   return enrichedSnapshot;
// }