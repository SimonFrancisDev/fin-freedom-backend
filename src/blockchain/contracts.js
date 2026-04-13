import { Contract } from 'ethers';
import { getProvider } from './provider.js';
import addresses from './addresses.js';

import levelManagerAbi from './abis/levelManager.abi.json' with { type: 'json' };
import p4OrbitAbi from './abis/p4Orbit.abi.json' with { type: 'json' };
import p12OrbitAbi from './abis/p12Orbit.abi.json' with { type: 'json' };
import p39OrbitAbi from './abis/p39Orbit.abi.json' with { type: 'json' };
import registrationAbi from './abis/registration.abi.json' with { type: 'json' };
import escrowAbi from './abis/escrow.abi.json' with { type: 'json' };
import usdtAbi from './abis/usdt.abi.json' with { type: 'json' };
import fgtTokenAbi from './abis/fgtToken.abi.json' with { type: 'json'};
import fgtrTokenAbi from './abis/fgtrToken.abi.json' with { type: 'json'};
import freedomTokenControllerAbi from './abis/freedomTokenController.abi.json' with { type: 'json'};

let contractsInstance = null;

export function getContracts() {
  if (contractsInstance) return contractsInstance;

  const provider = getProvider();

  contractsInstance = {
    provider,
    levelManager: new Contract(addresses.levelManager, levelManagerAbi, provider),
    p4Orbit: new Contract(addresses.p4Orbit, p4OrbitAbi, provider),
    p12Orbit: new Contract(addresses.p12Orbit, p12OrbitAbi, provider),
    p39Orbit: new Contract(addresses.p39Orbit, p39OrbitAbi, provider),
    registration: new Contract(addresses.registration, registrationAbi, provider),
    escrow: new Contract(addresses.escrow, escrowAbi, provider),
    usdt: new Contract(addresses.usdt, usdtAbi, provider),
    fgtToken: new Contract(addresses.fgtToken, fgtTokenAbi, provider),
    fgtrToken: new Contract(addresses.fgtrToken, fgtrTokenAbi, provider),
    freedomTokenController: new Contract(addresses.freedomTokenController, freedomTokenControllerAbi, provider),
  };
  return contractsInstance;
}

// export async function verifyContracts() {
//   const contracts = getContracts();

//   const [
//     levelManagerOwner,
//     levelManagerGuardian,
//     id1Wallet,
//     p4Owner,
//     p4LevelManager,
//     p12Owner,
//     p12LevelManager,
//     p39Owner,
//     p39LevelManager,
//     registrationOwner,
//     escrowOwner,
//   ] = await Promise.all([
//     contracts.levelManager.owner(),
//     contracts.levelManager.guardian(),
//     contracts.levelManager.id1Wallet(),
//     contracts.p4Orbit.owner(),
//     contracts.p4Orbit.levelManager(),
//     contracts.p12Orbit.owner(),
//     contracts.p12Orbit.levelManager(),
//     contracts.p39Orbit.owner(),
//     contracts.p39Orbit.levelManager(),
//     contracts.registration.owner(),
//     contracts.escrow.owner(),
//   ]);

//   return {
//     levelManager: {
//       address: addresses.levelManager,
//       owner: levelManagerOwner,
//       guardian: levelManagerGuardian,
//       id1Wallet,
//     },
//     p4Orbit: {
//       address: addresses.p4Orbit,
//       owner: p4Owner,
//       levelManager: p4LevelManager,
//     },
//     p12Orbit: {
//       address: addresses.p12Orbit,
//       owner: p12Owner,
//       levelManager: p12LevelManager,
//     },
//     p39Orbit: {
//       address: addresses.p39Orbit,
//       owner: p39Owner,
//       levelManager: p39LevelManager,
//     },
//     registration: {
//       address: addresses.registration,
//       owner: registrationOwner,
//     },
//     escrow: {
//       address: addresses.escrow,
//       owner: escrowOwner,
//     },
//   };
// }

export async function verifyContracts() {
  const contracts = getContracts();

  const [
    levelManagerOwner,
    levelManagerGuardian,
    id1Wallet,
    p4Owner,
    p4LevelManager,
    p12Owner,
    p12LevelManager,
    p39Owner,
    p39LevelManager,
    registrationOwner,
    escrowOwner,
    usdtOwner,
    fgtTokenOwner,
    fgtrTokenOwner,
    tokenControllerOwner,
  ] = await Promise.all([
    contracts.levelManager.owner(),
    contracts.levelManager.guardian(),
    contracts.levelManager.id1Wallet(),
    contracts.p4Orbit.owner(),
    contracts.p4Orbit.levelManager(),
    contracts.p12Orbit.owner(),
    contracts.p12Orbit.levelManager(),
    contracts.p39Orbit.owner(),
    contracts.p39Orbit.levelManager(),
    contracts.registration.owner(),
    contracts.escrow.owner(),
    contracts.usdt.owner().catch(() => 'N/A'),  // ← ADD THIS
    // Add these
    contracts.fgtToken.owner().catch(() => 'N/A'),
    contracts.fgtrToken.owner().catch(() => 'N/A'),
    contracts.freedomTokenController.owner().catch(() => 'N/A'),
  ]);

  return {
    levelManager: {
      address: addresses.levelManager,
      owner: levelManagerOwner,
      guardian: levelManagerGuardian,
      id1Wallet,
    },
    p4Orbit: {
      address: addresses.p4Orbit,
      owner: p4Owner,
      levelManager: p4LevelManager,
    },
    p12Orbit: {
      address: addresses.p12Orbit,
      owner: p12Owner,
      levelManager: p12LevelManager,
    },
    p39Orbit: {
      address: addresses.p39Orbit,
      owner: p39Owner,
      levelManager: p39LevelManager,
    },
    registration: {
      address: addresses.registration,
      owner: registrationOwner,
    },
    escrow: {
      address: addresses.escrow,
      owner: escrowOwner,
    },
     usdt: {           // ← ADD THIS
      address: addresses.usdt,
      owner: usdtOwner,
    },
    // Add token contract verification results
    fgtToken: {
      address: addresses.fgtToken,
      owner: fgtTokenOwner,
    },
    fgtrToken: {
      address: addresses.fgtrToken,
      owner: fgtrTokenOwner,
    },
    freedomTokenController: {
      address: addresses.freedomTokenController,
      owner: tokenControllerOwner,
    },
  };
}