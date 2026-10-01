import currentAbi from './abis/freedom-plus/FreedomPlusRegistration.abi.json' with { type: 'json' };

// Keep replay of the existing four-representative deployment readable after ABI regeneration.
export default [
  ...currentAbi,
  'event GenesisInitialized(address indexed id1Wallet, address[4] representatives)',
];
