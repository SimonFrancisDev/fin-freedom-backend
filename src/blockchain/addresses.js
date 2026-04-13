import { getAddress } from 'ethers';
import env from '../config/env.js';

function normalizeRequiredAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid required address for ${label}`);
  }
}

function normalizeOptionalAddress(value, label) {
  if (!value || String(value).trim() === '') return null;

  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid optional address for ${label}`);
  }
}

const addresses = Object.freeze({
  usdt: normalizeRequiredAddress(env.USDT_ADDRESS, 'USDT_ADDRESS'),
  escrow: normalizeRequiredAddress(env.ESCROW_ADDRESS, 'ESCROW_ADDRESS'),
  registration: normalizeRequiredAddress(env.REGISTRATION_ADDRESS, 'REGISTRATION_ADDRESS'),
  levelManager: normalizeRequiredAddress(env.LEVEL_MANAGER_ADDRESS, 'LEVEL_MANAGER_ADDRESS'),
  p4Orbit: normalizeRequiredAddress(env.P4_ORBIT_ADDRESS, 'P4_ORBIT_ADDRESS'),
  p12Orbit: normalizeRequiredAddress(env.P12_ORBIT_ADDRESS, 'P12_ORBIT_ADDRESS'),
  p39Orbit: normalizeRequiredAddress(env.P39_ORBIT_ADDRESS, 'P39_ORBIT_ADDRESS'),

  fgtToken: normalizeOptionalAddress(env.FGT_TOKEN_ADDRESS, 'FGT_TOKEN_ADDRESS'),
  fgtrToken: normalizeOptionalAddress(env.FGTR_TOKEN_ADDRESS, 'FGTR_TOKEN_ADDRESS'),
  freedomTokenController: normalizeOptionalAddress(
    env.FREEDOM_TOKEN_CONTROLLER_ADDRESS,
    'FREEDOM_TOKEN_CONTROLLER_ADDRESS'
  ),
  multisig: normalizeOptionalAddress(env.MULTISIG_ADDRESS, 'MULTISIG_ADDRESS'),
  guardian: normalizeOptionalAddress(env.GUARDIAN_ADDRESS, 'GUARDIAN_ADDRESS'),
});

export default addresses;












// import { getAddress } from 'ethers';
// import env from '../config/env.js';

// const addresses = {
//   usdt: getAddress(env.USDT_ADDRESS),
//   escrow: getAddress(env.ESCROW_ADDRESS),
//   registration: getAddress(env.REGISTRATION_ADDRESS),
//   levelManager: getAddress(env.LEVEL_MANAGER_ADDRESS),
//   p4Orbit: getAddress(env.P4_ORBIT_ADDRESS),
//   p12Orbit: getAddress(env.P12_ORBIT_ADDRESS),
//   p39Orbit: getAddress(env.P39_ORBIT_ADDRESS),

//   fgtToken: env.FGT_TOKEN_ADDRESS ? getAddress(env.FGT_TOKEN_ADDRESS) : null,
//   fgtrToken: env.FGTR_TOKEN_ADDRESS ? getAddress(env.FGTR_TOKEN_ADDRESS) : null,
//   freedomTokenController: env.FREEDOM_TOKEN_CONTROLLER_ADDRESS
//     ? getAddress(env.FREEDOM_TOKEN_CONTROLLER_ADDRESS)
//     : null,
//   multisig: env.MULTISIG_ADDRESS ? getAddress(env.MULTISIG_ADDRESS) : null,
//   guardian: env.GUARDIAN_ADDRESS ? getAddress(env.GUARDIAN_ADDRESS) : null,
// };

// export default addresses;