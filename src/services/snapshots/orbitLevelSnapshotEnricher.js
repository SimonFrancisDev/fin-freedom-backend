import { ethers } from 'ethers';
import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';

function formatUsdt(value) {
  try {
    return ethers.formatUnits(value ?? 0, 6);
  } catch {
    return '0.0';
  }
}

export async function enrichOrbitLevelSnapshot(address, level) {
  const normalized = address.toLowerCase();

  const snapshot = await OrbitLevelSnapshot.findOne({
    address: normalized,
    level,
  });

  if (!snapshot) return null;

  const { orbitContract, registration, escrow } = await getContracts();

  // =========================
  // LIGHT RPC (CONTROLLED)
  // =========================

  let isLevelActive = false;
  let orbitSummaryRaw = null;
  let lineCountsRaw = null;
  let lockedRaw = null;

  try {
    isLevelActive = await safeRpcCall(() =>
      registration.isLevelActivated(normalized, level)
    );
  } catch {}

  try {
    orbitSummaryRaw = await safeRpcCall(() =>
      orbitContract.getUserOrbit(normalized, level)
    );
  } catch {}

  try {
    lineCountsRaw = await safeRpcCall(() =>
      orbitContract.getLinePaymentCounts(normalized, level)
    );
  } catch {}

  try {
    lockedRaw = await safeRpcCall(() =>
      escrow.lockedFunds(normalized, level, level + 1)
    );
  } catch {}

  // =========================
  // FORMAT DATA
  // =========================

  const orbitSummary = {
    currentPosition: Number(orbitSummaryRaw?.currentPosition || 0),
    escrowBalance: formatUsdt(orbitSummaryRaw?.escrowBalance || '0'),
    autoUpgradeCompleted: Boolean(
      orbitSummaryRaw?.autoUpgradeCompleted || false
    ),
    positionsInLine1: Number(orbitSummaryRaw?.positionsInLine1 || 0),
    positionsInLine2: Number(orbitSummaryRaw?.positionsInLine2 || 0),
    positionsInLine3: Number(orbitSummaryRaw?.positionsInLine3 || 0),
    totalCycles: Number(orbitSummaryRaw?.totalCycles || 0),
    totalEarned: formatUsdt(orbitSummaryRaw?.totalEarned || '0'),
  };

  const linePaymentCounts = {
    line1: Number(lineCountsRaw?.[0] || 0),
    line2: Number(lineCountsRaw?.[1] || 0),
    line3: Number(lineCountsRaw?.[2] || 0),
  };

  const lockedForNextLevel = formatUsdt(lockedRaw || '0');

  // =========================
  // SAVE INTO SNAPSHOT
  // =========================

  const updated = await OrbitLevelSnapshot.findOneAndUpdate(
    { address: normalized, level },
    {
      $set: {
        isLevelActive,
        orbitSummary,
        linePaymentCounts,
        lockedForNextLevel,
        'metadata.enrichedAt': new Date(),
        'metadata.completeness.summaryReady': true,
      },
    },
    {
      returnDocument: 'after', // ✅ FIXED WARNING HERE
    }
  );

  return updated;
}