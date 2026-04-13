import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value && String(value).trim() !== '' ? value : fallback;
}

function optionalNumber(name, fallback) {
  const raw = optional(name, String(fallback));
  const num = Number(raw);
  return Number.isFinite(num) ? num : Number(fallback);
}

function optionalBoolean(name, fallback = false) {
  const raw = optional(name, fallback ? 'true' : 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const env = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: optionalNumber('PORT', 5000),

  MONGODB_URI: required('MONGODB_URI'),

  CHAIN_ID: optionalNumber('CHAIN_ID', 80002),
  RPC_URL: required('RPC_URL'),
  WS_RPC_URL: optional('WS_RPC_URL', ''),
  START_BLOCK: optionalNumber('START_BLOCK', 0),

  START_BLOCK_REGISTRATION: optionalNumber('START_BLOCK_REGISTRATION', 0),
  START_BLOCK_LEVEL_MANAGER: optionalNumber('START_BLOCK_LEVEL_MANAGER', 0),
  START_BLOCK_P4_ORBIT: optionalNumber('START_BLOCK_P4_ORBIT', 0),
  START_BLOCK_P12_ORBIT: optionalNumber('START_BLOCK_P12_ORBIT', 0),
  START_BLOCK_P39_ORBIT: optionalNumber('START_BLOCK_P39_ORBIT', 0),

  SYNC_CONFIRMATIONS: optionalNumber('SYNC_CONFIRMATIONS', 3),
  SYNC_BLOCK_CHUNK_SIZE: optionalNumber('SYNC_BLOCK_CHUNK_SIZE', 3),
  SYNC_POLL_INTERVAL_MS: optionalNumber('SYNC_POLL_INTERVAL_MS', 30000),

  RUN_INDEXER: optionalBoolean('RUN_INDEXER', false),

  USDT_ADDRESS: required('USDT_ADDRESS'),
  ESCROW_ADDRESS: required('ESCROW_ADDRESS'),
  REGISTRATION_ADDRESS: required('REGISTRATION_ADDRESS'),
  LEVEL_MANAGER_ADDRESS: required('LEVEL_MANAGER_ADDRESS'),
  P4_ORBIT_ADDRESS: required('P4_ORBIT_ADDRESS'),
  P12_ORBIT_ADDRESS: required('P12_ORBIT_ADDRESS'),
  P39_ORBIT_ADDRESS: required('P39_ORBIT_ADDRESS'),

  FGT_TOKEN_ADDRESS: optional('FGT_TOKEN_ADDRESS'),
  FGTR_TOKEN_ADDRESS: optional('FGTR_TOKEN_ADDRESS'),
  FREEDOM_TOKEN_CONTROLLER_ADDRESS: optional('FREEDOM_TOKEN_CONTROLLER_ADDRESS'),
  MULTISIG_ADDRESS: optional('MULTISIG_ADDRESS'),
  GUARDIAN_ADDRESS: optional('GUARDIAN_ADDRESS'),
  ADMIN_API_KEY: optional('ADMIN_API_KEY'),
  ADMIN_API_HEADER: optional('ADMIN_API_HEADER', 'x-admin-key'),

  API_RATE_LIMIT_WINDOW_MS: optionalNumber('API_RATE_LIMIT_WINDOW_MS', 60000),
  API_RATE_LIMIT_MAX: optionalNumber('API_RATE_LIMIT_MAX', 300),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
};

export default env;







// import 'dotenv/config';

// function required(name) {
//   const value = process.env[name];
//   if (!value || String(value).trim() === '') {
//     throw new Error(`Missing required env variable: ${name}`);
//   }
//   return value;
// }

// function optional(name, fallback = '') {
//   const value = process.env[name];
//   return value && String(value).trim() !== '' ? value : fallback;
// }

// const env = {
//   NODE_ENV: optional('NODE_ENV', 'development'),
//   PORT: Number(optional('PORT', '5000')),

//   MONGODB_URI: required('MONGODB_URI'),

//   CHAIN_ID: Number(required('CHAIN_ID')),
//   RPC_URL: required('RPC_URL'),
//   WS_RPC_URL: optional('WS_RPC_URL', ''),
//   START_BLOCK: Number(optional('START_BLOCK', '0')),

//   START_BLOCK_REGISTRATION: Number(optional('START_BLOCK_REGISTRATION', '0')),
//   START_BLOCK_LEVEL_MANAGER: Number(optional('START_BLOCK_LEVEL_MANAGER', '0')),
//   START_BLOCK_P4_ORBIT: Number(optional('START_BLOCK_P4_ORBIT', '0')),
//   START_BLOCK_P12_ORBIT: Number(optional('START_BLOCK_P12_ORBIT', '0')),
//   START_BLOCK_P39_ORBIT: Number(optional('START_BLOCK_P39_ORBIT', '0')),

//   SYNC_CONFIRMATIONS: Number(optional('SYNC_CONFIRMATIONS', '3')),
//   SYNC_BLOCK_CHUNK_SIZE: Number(optional('SYNC_BLOCK_CHUNK_SIZE', '10')),
//   SYNC_POLL_INTERVAL_MS: Number(optional('SYNC_POLL_INTERVAL_MS', '15000')),

//   USDT_ADDRESS: required('USDT_ADDRESS'),
//   ESCROW_ADDRESS: required('ESCROW_ADDRESS'),
//   REGISTRATION_ADDRESS: required('REGISTRATION_ADDRESS'),
//   LEVEL_MANAGER_ADDRESS: required('LEVEL_MANAGER_ADDRESS'),
//   P4_ORBIT_ADDRESS: required('P4_ORBIT_ADDRESS'),
//   P12_ORBIT_ADDRESS: required('P12_ORBIT_ADDRESS'),
//   P39_ORBIT_ADDRESS: required('P39_ORBIT_ADDRESS'),

//   FGT_TOKEN_ADDRESS: optional('FGT_TOKEN_ADDRESS'),
//   FGTR_TOKEN_ADDRESS: optional('FGTR_TOKEN_ADDRESS'),
//   FREEDOM_TOKEN_CONTROLLER_ADDRESS: optional('FREEDOM_TOKEN_CONTROLLER_ADDRESS'),
//   MULTISIG_ADDRESS: optional('MULTISIG_ADDRESS'),
//   GUARDIAN_ADDRESS: optional('GUARDIAN_ADDRESS'),
//   ADMIN_API_KEY: optional('ADMIN_API_KEY'),
//   ADMIN_API_HEADER: optional('ADMIN_API_HEADER'),

//   API_RATE_LIMIT_WINDOW_MS: Number(optional('API_RATE_LIMIT_WINDOW_MS', '60000')),
//   API_RATE_LIMIT_MAX: Number(optional('API_RATE_LIMIT_MAX', '300')),
//   LOG_LEVEL: optional('LOG_LEVEL', 'info'),

// };

// export default env;