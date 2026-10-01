import { getAddress } from 'ethers';
import env from '../config/env.js';

const fields = {
  registration: 'FREEDOM_PLUS_REGISTRATION_ADDRESS',
  levelManager: 'FREEDOM_PLUS_LEVEL_MANAGER_ADDRESS',
  settlementRouter: 'FREEDOM_PLUS_SETTLEMENT_ROUTER_ADDRESS',
  p39Orbit: 'FREEDOM_PLUS_P39_ORBIT_ADDRESS',
  p14Orbit: 'FREEDOM_PLUS_P14_ORBIT_ADDRESS',
  p12Orbit: 'FREEDOM_PLUS_P12_ORBIT_ADDRESS',
  p6Orbit: 'FREEDOM_PLUS_P6_ORBIT_ADDRESS',
  p4Orbit: 'FREEDOM_PLUS_P4_ORBIT_ADDRESS',
  p3Orbit: 'FREEDOM_PLUS_P3_ORBIT_ADDRESS',
  fpt: 'FREEDOM_PLUS_FPT_ADDRESS',
  fptr: 'FREEDOM_PLUS_FPTR_ADDRESS',
  tokenController: 'FREEDOM_PLUS_TOKEN_CONTROLLER_ADDRESS',
  nftMembership: 'FREEDOM_NFT_MEMBERSHIP_ADDRESS',
  nftRewardDistributor: 'FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS',
  nftPoolVault: 'FREEDOM_NFT_POOL_VAULT_ADDRESS',
  operationsVault: 'FREEDOM_PLUS_OPERATIONS_VAULT_ADDRESS',
};

const values = {};
for (const [key, envName] of Object.entries(fields)) {
  const raw = env[envName];
  if (!env.FREEDOM_PLUS_ENABLED) {
    values[key] = null;
    continue;
  }
  try {
    values[key] = getAddress(raw);
  } catch {
    throw new Error(`Invalid required address for ${envName}`);
  }
}

function requiredSystemAddress(envName) {
  if (!env.FREEDOM_PLUS_ENABLED) return null;
  try {
    return getAddress(env[envName]);
  } catch {
    throw new Error(`Invalid required address for ${envName}`);
  }
}

export const freedomPlusSystemVaults = Object.freeze({
  nftPoolVault: requiredSystemAddress('FREEDOM_NFT_POOL_VAULT_ADDRESS'),
  operationsVault: requiredSystemAddress('FREEDOM_PLUS_OPERATIONS_VAULT_ADDRESS'),
});

export default Object.freeze(values);
