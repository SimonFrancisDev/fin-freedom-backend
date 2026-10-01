import { Contract } from 'ethers';
import env from '../config/env.js';
import { getProvider, safeRpcCall } from './provider.js';
import addresses, { freedomPlusSystemVaults } from './freedomPlusAddresses.js';

import registrationAbi from './freedomPlusRegistrationAbi.js';
import levelManagerAbi from './abis/freedom-plus/FreedomPlusLevelManager.abi.json' with { type: 'json' };
import routerAbi from './abis/freedom-plus/FreedomPlusSettlementRouter.abi.json' with { type: 'json' };
import p39Abi from './abis/freedom-plus/P39PlusOrbit.abi.json' with { type: 'json' };
import p14Abi from './abis/freedom-plus/P14PlusOrbit.abi.json' with { type: 'json' };
import p12Abi from './abis/freedom-plus/P12PlusOrbit.abi.json' with { type: 'json' };
import p6Abi from './abis/freedom-plus/P6PlusOrbit.abi.json' with { type: 'json' };
import p4Abi from './abis/freedom-plus/P4PlusOrbit.abi.json' with { type: 'json' };
import p3Abi from './abis/freedom-plus/P3PlusOrbit.abi.json' with { type: 'json' };
import fptAbi from './abis/freedom-plus/FPTToken.abi.json' with { type: 'json' };
import fptrAbi from './abis/freedom-plus/FPTrToken.abi.json' with { type: 'json' };
import tokenControllerAbi from './abis/freedom-plus/FreedomPlusTokenController.abi.json' with { type: 'json' };
import nftMembershipAbi from './abis/freedom-plus/FreedomNFTMembership.abi.json' with { type: 'json' };
import nftRewardDistributorAbi from './abis/freedom-plus/FreedomNFTRewardDistributor.abi.json' with { type: 'json' };
import nftPoolVaultAbi from './abis/freedom-plus/FreedomNFTPoolVault.abi.json' with { type: 'json' };
import operationsVaultAbi from './abis/freedom-plus/FreedomPlusOperationsVault.abi.json' with { type: 'json' };

const specifications = {
  registration: registrationAbi,
  levelManager: levelManagerAbi,
  settlementRouter: routerAbi,
  p39Orbit: p39Abi,
  p14Orbit: p14Abi,
  p12Orbit: p12Abi,
  p6Orbit: p6Abi,
  p4Orbit: p4Abi,
  p3Orbit: p3Abi,
  fpt: fptAbi,
  fptr: fptrAbi,
  tokenController: tokenControllerAbi,
  nftMembership: nftMembershipAbi,
  nftRewardDistributor: nftRewardDistributorAbi,
  nftPoolVault: nftPoolVaultAbi,
  operationsVault: operationsVaultAbi,
};

let instance;

export function getFreedomPlusContracts(provider = getProvider()) {
  if (!env.FREEDOM_PLUS_ENABLED) return null;
  if (instance && provider === instance.provider) return instance;
  const contracts = { provider };
  for (const [key, abi] of Object.entries(specifications)) {
    contracts[key] = new Contract(addresses[key], abi, provider);
  }
  instance = Object.freeze(contracts);
  return instance;
}

export function getFreedomPlusContractEntries(provider = getProvider()) {
  const contracts = getFreedomPlusContracts(provider);
  if (!contracts) return [];
  return Object.entries(specifications).map(([key]) => [key, contracts[key]]);
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function assertAddress(label, actual, expected) {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

export async function verifyFreedomPlusContracts() {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false };
  const contracts = getFreedomPlusContracts();
  const entries = getFreedomPlusContractEntries(contracts.provider);
  for (const [key, contract] of entries) {
    if ((await safeRpcCall((provider) => provider.getCode(contract.target))) === '0x') {
      throw new Error(`Freedom-Plus ${key} has no contract code at ${contract.target}`);
    }
  }

  const [
    registrationManager,
    managerRegistration,
    managerRouter,
    controllerManager,
    routerLocked,
    membershipFpt,
    rewardVault,
    vaultDistributor,
    routerNftPoolVault,
    routerOperationsVault,
  ] = await Promise.all([
    safeRpcCall(() => contracts.registration.levelManager()),
    safeRpcCall(() => contracts.levelManager.registration()),
    safeRpcCall(() => contracts.levelManager.settlementRouter()),
    safeRpcCall(() => contracts.tokenController.levelManager()),
    safeRpcCall(() => contracts.settlementRouter.configurationLocked()),
    safeRpcCall(() => contracts.nftMembership.fpt()),
    safeRpcCall(() => contracts.nftRewardDistributor.vault()),
    safeRpcCall(() => contracts.nftPoolVault.distributor()),
    safeRpcCall(() => contracts.settlementRouter.nftPoolVault()),
    safeRpcCall(() => contracts.settlementRouter.operationsVault()),
  ]);
  assertAddress('registration.levelManager', registrationManager, addresses.levelManager);
  assertAddress('levelManager.registration', managerRegistration, addresses.registration);
  assertAddress('levelManager.settlementRouter', managerRouter, addresses.settlementRouter);
  assertAddress('tokenController.levelManager', controllerManager, addresses.levelManager);
  if (!routerLocked) throw new Error('Freedom-Plus settlement router configuration is not locked');
  assertAddress('nftMembership.fpt', membershipFpt, addresses.fpt);
  assertAddress('nftRewardDistributor.vault', rewardVault, addresses.nftPoolVault);
  assertAddress('nftPoolVault.distributor', vaultDistributor, addresses.nftRewardDistributor);
  assertAddress('settlementRouter.nftPoolVault', routerNftPoolVault, freedomPlusSystemVaults.nftPoolVault);
  assertAddress('settlementRouter.operationsVault', routerOperationsVault, freedomPlusSystemVaults.operationsVault);

  const orbitKeys = ['p39Orbit', 'p14Orbit', 'p12Orbit', 'p6Orbit', 'p4Orbit', 'p3Orbit'];
  for (let type = 0; type < orbitKeys.length; type += 1) {
    const key = orbitKeys[type];
    assertAddress(`settlementRouter.orbitByType(${type})`, await safeRpcCall(() => contracts.settlementRouter.orbitByType(type)), addresses[key]);
    assertAddress(`${key}.manager`, await safeRpcCall(() => contracts[key].manager()), addresses.settlementRouter);
  }

  const owners = {};
  for (const [key, contract] of entries) {
    if (typeof contract.owner !== 'function') continue;
    owners[key] = await safeRpcCall(() => contract.owner());
    if (env.MULTISIG_ADDRESS) assertAddress(`${key}.owner`, owners[key], env.MULTISIG_ADDRESS);
  }
  return {
    enabled: true,
    addresses,
    systemVaults: freedomPlusSystemVaults,
    owners,
  };
}
