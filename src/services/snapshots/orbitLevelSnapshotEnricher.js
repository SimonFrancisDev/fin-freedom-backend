import { ethers } from 'ethers';
import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';

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

async function getLockedForNextLevel(contracts, address, level) {
  if (level >= 10) return 0n;

  if (typeof contracts?.escrow?.getLockedAmount === 'function') {
    return safeRpcCall(() =>
      contracts.escrow.getLockedAmount(address, level, level + 1)
    );
  }

  if (typeof contracts?.escrow?.lockedFunds === 'function') {
    return safeRpcCall(() =>
      contracts.escrow.lockedFunds(address, level, level + 1)
    );
  }

  return 0n;
}

export async function enrichOrbitLevelSnapshot(address, level) {
  const normalizedAddress = normalizeAddress(address);
  validateLevel(level);

  const snapshot = await OrbitLevelSnapshot.findOne({
    address: normalizedAddress,
    level,
  });

  if (!snapshot) return null;

  const contracts = getContracts();
  const { registration, escrow, p4Orbit, p12Orbit, p39Orbit } = contracts;

  // Match the orbit contract to the level
  let orbitContract = null;
  if ([1, 4, 7, 10].includes(level)) {
    orbitContract = p4Orbit;
  } else if ([2, 5, 8].includes(level)) {
    orbitContract = p12Orbit;
  } else if ([3, 6, 9].includes(level)) {
    orbitContract = p39Orbit;
  }

  if (!orbitContract) {
    const error = new Error(`No orbit contract found for level ${level}`);
    error.status = 500;
    throw error;
  }

  // Start from DB truth. Do not let contract override cycle structure fields.
  let isLevelActive = snapshot.isLevelActive ?? false;

  let orbitSummary = {
    currentPosition: Number(snapshot?.orbitSummary?.currentPosition || 0),
    escrowBalance: String(snapshot?.orbitSummary?.escrowBalance || '0'),
    autoUpgradeCompleted: Boolean(
      snapshot?.orbitSummary?.autoUpgradeCompleted || false
    ),
    positionsInLine1: Number(snapshot?.orbitSummary?.positionsInLine1 || 0),
    positionsInLine2: Number(snapshot?.orbitSummary?.positionsInLine2 || 0),
    positionsInLine3: Number(snapshot?.orbitSummary?.positionsInLine3 || 0),
    totalCycles: Number(snapshot?.orbitSummary?.totalCycles || 0),
    totalEarned: String(snapshot?.orbitSummary?.totalEarned || '0'),
  };

  let linePaymentCounts = {
    line1: Number(snapshot?.linePaymentCounts?.line1 || 0),
    line2: Number(snapshot?.linePaymentCounts?.line2 || 0),
    line3: Number(snapshot?.linePaymentCounts?.line3 || 0),
  };

  let lockedForNextLevel = String(snapshot?.lockedForNextLevel || '0');

  // Safe enrich: is active
  try {
    isLevelActive = await safeRpcCall(() =>
      registration.isLevelActivated(normalizedAddress, level)
    );
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: isLevelActivated failed for ${normalizedAddress} level ${level}`,
      error
    );
  }

  // Safe enrich: line payment counts
  try {
    const raw = await safeRpcCall(() =>
      orbitContract.getLinePaymentCounts(normalizedAddress, level)
    );

    linePaymentCounts = {
      line1: Number(raw?.[0] || 0),
      line2: Number(raw?.[1] || 0),
      line3: Number(raw?.[2] || 0),
    };
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: getLinePaymentCounts failed for ${normalizedAddress} level ${level}`,
      error
    );
  }

  // Safe enrich: locked for next level
  try {
    const lockedRaw = await getLockedForNextLevel(
      contracts,
      normalizedAddress,
      level
    );
    lockedForNextLevel = formatUsdt(lockedRaw || '0');
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: getLockedForNextLevel failed for ${normalizedAddress} level ${level}`,
      error
    );
  }

  // Limited orbit summary enrich
  try {
    const raw = await safeRpcCall(() =>
      orbitContract.getUserOrbit(normalizedAddress, level)
    );

    orbitSummary = {
      ...orbitSummary,

      // Safe to enrich
      escrowBalance: formatUsdt(raw?.escrowBalance || '0'),
      totalEarned: formatUsdt(raw?.totalEarned || '0'),
      autoUpgradeCompleted: Boolean(raw?.autoUpgradeCompleted || false),

      // Intentionally preserved from DB snapshot:
      // currentPosition
      // positionsInLine1
      // positionsInLine2
      // positionsInLine3
      // totalCycles
    };
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: getUserOrbit failed for ${normalizedAddress} level ${level}`,
      error
    );
  }

  const updated = await OrbitLevelSnapshot.findOneAndUpdate(
    { address: normalizedAddress, level },
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
      returnDocument: 'after',
    }
  ).lean();

  return updated;
}













// import { ethers } from 'ethers';
// import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
// import { getContracts } from '../../blockchain/contracts.js';
// import { safeRpcCall } from '../../blockchain/provider.js';

// function formatUsdt(value) {
//   try {
//     return ethers.formatUnits(value ?? 0, 6);
//   } catch {
//     return '0.0';
//   }
// }

// export async function enrichOrbitLevelSnapshot(address, level) {
//   const normalized = address.toLowerCase();

//   const snapshot = await OrbitLevelSnapshot.findOne({
//     address: normalized,
//     level,
//   });

//   if (!snapshot) return null;

//   const { orbitContract, registration, escrow } = await getContracts();

//   // =========================
//   // LIGHT RPC (CONTROLLED)
//   // =========================

//   let isLevelActive = false;
//   let orbitSummaryRaw = null;
//   let lineCountsRaw = null;
//   let lockedRaw = null;

//   try {
//     isLevelActive = await safeRpcCall(() =>
//       registration.isLevelActivated(normalized, level)
//     );
//   } catch {}

//   try {
//     orbitSummaryRaw = await safeRpcCall(() =>
//       orbitContract.getUserOrbit(normalized, level)
//     );
//   } catch {}

//   try {
//     lineCountsRaw = await safeRpcCall(() =>
//       orbitContract.getLinePaymentCounts(normalized, level)
//     );
//   } catch {}

//   try {
//     lockedRaw = await safeRpcCall(() =>
//       escrow.lockedFunds(normalized, level, level + 1)
//     );
//   } catch {}

//   // =========================
//   // FORMAT DATA
//   // =========================

//   const orbitSummary = {
//     currentPosition: Number(orbitSummaryRaw?.currentPosition || 0),
//     escrowBalance: formatUsdt(orbitSummaryRaw?.escrowBalance || '0'),
//     autoUpgradeCompleted: Boolean(
//       orbitSummaryRaw?.autoUpgradeCompleted || false
//     ),
//     positionsInLine1: Number(orbitSummaryRaw?.positionsInLine1 || 0),
//     positionsInLine2: Number(orbitSummaryRaw?.positionsInLine2 || 0),
//     positionsInLine3: Number(orbitSummaryRaw?.positionsInLine3 || 0),
//     totalCycles: Number(orbitSummaryRaw?.totalCycles || 0),
//     totalEarned: formatUsdt(orbitSummaryRaw?.totalEarned || '0'),
//   };

//   const linePaymentCounts = {
//     line1: Number(lineCountsRaw?.[0] || 0),
//     line2: Number(lineCountsRaw?.[1] || 0),
//     line3: Number(lineCountsRaw?.[2] || 0),
//   };

//   const lockedForNextLevel = formatUsdt(lockedRaw || '0');

//   // =========================
//   // SAVE INTO SNAPSHOT
//   // =========================

//   const updated = await OrbitLevelSnapshot.findOneAndUpdate(
//     { address: normalized, level },
//     {
//       $set: {
//         isLevelActive,
//         orbitSummary,
//         linePaymentCounts,
//         lockedForNextLevel,
//         'metadata.enrichedAt': new Date(),
//         'metadata.completeness.summaryReady': true,
//       },
//     },
//     {
//       returnDocument: 'after', 
//     }
//   );

//   return updated;
// }