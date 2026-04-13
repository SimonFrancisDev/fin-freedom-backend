import { getAddress } from 'ethers';
import env from '../config/env.js';

const addresses = {
  usdt: getAddress(env.USDT_ADDRESS),
  escrow: getAddress(env.ESCROW_ADDRESS),
  registration: getAddress(env.REGISTRATION_ADDRESS),
  levelManager: getAddress(env.LEVEL_MANAGER_ADDRESS),
  p4Orbit: getAddress(env.P4_ORBIT_ADDRESS),
  p12Orbit: getAddress(env.P12_ORBIT_ADDRESS),
  p39Orbit: getAddress(env.P39_ORBIT_ADDRESS),

  fgtToken: env.FGT_TOKEN_ADDRESS ? getAddress(env.FGT_TOKEN_ADDRESS) : null,
  fgtrToken: env.FGTR_TOKEN_ADDRESS ? getAddress(env.FGTR_TOKEN_ADDRESS) : null,
  freedomTokenController: env.FREEDOM_TOKEN_CONTROLLER_ADDRESS
    ? getAddress(env.FREEDOM_TOKEN_CONTROLLER_ADDRESS)
    : null,
  multisig: env.MULTISIG_ADDRESS ? getAddress(env.MULTISIG_ADDRESS) : null,
  guardian: env.GUARDIAN_ADDRESS ? getAddress(env.GUARDIAN_ADDRESS) : null,
};

export default addresses;