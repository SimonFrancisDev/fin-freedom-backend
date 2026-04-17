import { ethers } from 'ethers';
import OrbitLevelSnapshot from '../../models/OrbitLevelSnapshot.js';
import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';

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

function pickOrbitContract(contracts, level) {
  const orbitType = levelToOrbitType[level];
  const contractKey = orbitTypeToContractKey[orbitType];

  if (!orbitType || !contractKey || !contracts?.[contractKey]) {
    const error = new Error(`Unsupported orbit contract for level ${level}`);
    error.status = 400;
    throw error;
  }

  return {
    orbitType,
    orbitContract: contracts[contractKey],
  };
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
  const { orbitType, orbitContract } = pickOrbitContract(contracts, level);
  const { registration } = contracts;

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

  // registration.isLevelActivated
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

  // orbitContract.getUserOrbit
  try {
    const orbitSummaryRaw = await safeRpcCall(() =>
      orbitContract.getUserOrbit(normalizedAddress, level)
    );

    orbitSummary = {
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
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: getUserOrbit failed for ${orbitType} ${normalizedAddress} level ${level}`,
      error
    );
  }

  // orbitContract.getLinePaymentCounts
  try {
    const lineCountsRaw = await safeRpcCall(() =>
      orbitContract.getLinePaymentCounts(normalizedAddress, level)
    );

    linePaymentCounts = {
      line1: Number(lineCountsRaw?.[0] || 0),
      line2: Number(lineCountsRaw?.[1] || 0),
      line3: Number(lineCountsRaw?.[2] || 0),
    };
  } catch (error) {
    console.error(
      `enrichOrbitLevelSnapshot: getLinePaymentCounts failed for ${orbitType} ${normalizedAddress} level ${level}`,
      error
    );
  }

  // escrow locked amount
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

  const updated = await OrbitLevelSnapshot.findOneAndUpdate(
    { address: normalizedAddress, level },
    {
      $set: {
        orbitType,
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