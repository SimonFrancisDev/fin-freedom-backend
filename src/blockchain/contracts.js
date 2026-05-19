import { Contract } from 'ethers';
import { getProvider, safeRpcCall } from './provider.js';
import addresses from './addresses.js';

import levelManagerAbi from './abis/levelManager.abi.json' with { type: 'json' };
import p4OrbitAbi from './abis/p4Orbit.abi.json' with { type: 'json' };
import p12OrbitAbi from './abis/p12Orbit.abi.json' with { type: 'json' };
import p39OrbitAbi from './abis/p39Orbit.abi.json' with { type: 'json' };
import registrationAbi from './abis/registration.abi.json' with { type: 'json' };
import escrowAbi from './abis/escrow.abi.json' with { type: 'json' };
import usdtAbi from './abis/usdt.abi.json' with { type: 'json' };
import fgtTokenAbi from './abis/fgtToken.abi.json' with { type: 'json' };
import fgtrTokenAbi from './abis/fgtrToken.abi.json' with { type: 'json' };
import freedomTokenControllerAbi from './abis/freedomTokenController.abi.json' with { type: 'json' };

let contractsInstance = null;

const group3LevelManagerEventAbi = [
  'event PayoutNotDelivered(address indexed affectedUser,address indexed sourceUser,uint8 indexed level,uint8 orbitType,uint8 sourcePosition,uint32 sourceCycle,uint256 expectedAmount,address actualReceiver,uint256 actualAmount,uint8 receiptType,bytes32 routedRole,bytes32 reasonCode,bytes32 actionCode,uint256 activationId)',
  'event RecycleCompletedDetailed(uint256 indexed activationId,address indexed orbitOwner,uint8 indexed level,address sourceUser,uint8 sourcePosition,uint32 sourceCycle,address recycleReceiver,uint256 recycleGross,uint256 recycleLiquidPaid,uint256 recycleEscrowLocked,uint8 mirrorPosition,uint32 mirrorCycle,bool triggeredOrbitReset)',
  'event AutoUpgradeCompleted(uint256 indexed activationId,address indexed user,uint8 indexed fromLevel,uint8 toLevel,uint256 requiredAmount,uint256 usedAmount,uint256 escrowBefore,uint256 escrowAfter)',
  'event FounderDistributionDetailed(uint256 indexed activationId,address indexed sourceUser,uint8 indexed level,address founderWallet,uint256 amount,uint256 ratioBps,bytes32 reasonCode)',
  'event SystemChargeDistributedDetailed(uint256 indexed activationId,address indexed user,uint8 indexed level,uint256 systemChargeTotal,uint256 nftPoolAmount,uint256 operationsAmount,address nftPool,address operationsWallet)',
];

const group3TokenControllerEventAbi = [
  'event TokenRewardEligibility(address indexed user,uint8 indexed level,bytes32 indexed rewardType,uint256 amount,bool eligible,bytes32 reasonCode)',
];

function mergeAbi(baseAbi, extraFragments) {
  return [...baseAbi, ...extraFragments];
}

function buildOptionalContract(address, abi, provider) {
  if (!address) return null;
  return new Contract(address, abi, provider);
}

export function getContracts() {
  if (contractsInstance) return contractsInstance;

  const provider = getProvider();

  contractsInstance = Object.freeze({
    provider,
    levelManager: new Contract(
      addresses.levelManager,
      mergeAbi(levelManagerAbi, group3LevelManagerEventAbi),
      provider
    ),
    p4Orbit: new Contract(addresses.p4Orbit, p4OrbitAbi, provider),
    p12Orbit: new Contract(addresses.p12Orbit, p12OrbitAbi, provider),
    p39Orbit: new Contract(addresses.p39Orbit, p39OrbitAbi, provider),
    registration: new Contract(addresses.registration, registrationAbi, provider),
    escrow: new Contract(addresses.escrow, escrowAbi, provider),
    usdt: new Contract(addresses.usdt, usdtAbi, provider),

    fgtToken: buildOptionalContract(addresses.fgtToken, fgtTokenAbi, provider),
    fgtrToken: buildOptionalContract(addresses.fgtrToken, fgtrTokenAbi, provider),
    freedomTokenController: buildOptionalContract(
      addresses.freedomTokenController,
      mergeAbi(freedomTokenControllerAbi, group3TokenControllerEventAbi),
      provider
    ),
  });

  return contractsInstance;
}

export function hasOptionalContracts() {
  const contracts = getContracts();

  return {
    fgtToken: Boolean(contracts.fgtToken),
    fgtrToken: Boolean(contracts.fgtrToken),
    freedomTokenController: Boolean(contracts.freedomTokenController),
  };
}

async function safeOptionalOwner(contract) {
  try {
    if (!contract || typeof contract.owner !== 'function') return 'N/A';
    return await safeRpcCall(() => contract.owner());
  } catch {
    return 'N/A';
  }
}

async function safeRequiredCall(label, fn) {
  try {
    return await safeRpcCall(fn);
  } catch (error) {
    error.message = `${label} verification failed: ${error.message}`;
    throw error;
  }
}

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
    safeRequiredCall('levelManager.owner', () => contracts.levelManager.owner()),
    safeRequiredCall('levelManager.guardian', () => contracts.levelManager.guardian()),
    safeRequiredCall('levelManager.id1Wallet', () => contracts.levelManager.id1Wallet()),

    safeRequiredCall('p4Orbit.owner', () => contracts.p4Orbit.owner()),
    safeRequiredCall('p4Orbit.levelManager', () => contracts.p4Orbit.levelManager()),

    safeRequiredCall('p12Orbit.owner', () => contracts.p12Orbit.owner()),
    safeRequiredCall('p12Orbit.levelManager', () => contracts.p12Orbit.levelManager()),

    safeRequiredCall('p39Orbit.owner', () => contracts.p39Orbit.owner()),
    safeRequiredCall('p39Orbit.levelManager', () => contracts.p39Orbit.levelManager()),

    safeRequiredCall('registration.owner', () => contracts.registration.owner()),
    safeRequiredCall('escrow.owner', () => contracts.escrow.owner()),

    safeOptionalOwner(contracts.usdt),
    safeOptionalOwner(contracts.fgtToken),
    safeOptionalOwner(contracts.fgtrToken),
    safeOptionalOwner(contracts.freedomTokenController),
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
    usdt: {
      address: addresses.usdt,
      owner: usdtOwner,
    },
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
