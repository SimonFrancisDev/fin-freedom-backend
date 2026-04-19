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
  if (!Number.isFinite(num)) return Number(fallback);
  return num;
}

function optionalInteger(name, fallback) {
  const num = optionalNumber(name, fallback);
  return Number.isInteger(num) ? num : Number(fallback);
}

function optionalBoolean(name, fallback = false) {
  const raw = optional(name, fallback ? 'true' : 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

const env = {
  NODE_ENV: optional('NODE_ENV', 'production'),
  PORT: clamp(optionalInteger('PORT', 5000), 1, 65535, 5000),

  MONGODB_URI: required('MONGODB_URI'),

  CHAIN_ID: optionalInteger('CHAIN_ID', 80002),

  // Multi-RPC support
  RPC_URL_1: optional('RPC_URL_1'),
  RPC_URL_2: optional('RPC_URL_2'),
  RPC_URL_3: optional('RPC_URL_3'),

  // Backward compatibility fallback
  RPC_URL: optional('RPC_URL', ''),

  WS_RPC_URL: optional('WS_RPC_URL', ''),

  START_BLOCK: Math.max(0, optionalInteger('START_BLOCK', 0)),
  START_BLOCK_REGISTRATION: Math.max(
    0,
    optionalInteger('START_BLOCK_REGISTRATION', 0)
  ),
  START_BLOCK_LEVEL_MANAGER: Math.max(
    0,
    optionalInteger('START_BLOCK_LEVEL_MANAGER', 0)
  ),
  START_BLOCK_P4_ORBIT: Math.max(0, optionalInteger('START_BLOCK_P4_ORBIT', 0)),
  START_BLOCK_P12_ORBIT: Math.max(
    0,
    optionalInteger('START_BLOCK_P12_ORBIT', 0)
  ),
  START_BLOCK_P39_ORBIT: Math.max(
    0,
    optionalInteger('START_BLOCK_P39_ORBIT', 0)
  ),

  SYNC_CONFIRMATIONS: clamp(optionalInteger('SYNC_CONFIRMATIONS', 2), 0, 100, 2),
  SYNC_BLOCK_CHUNK_SIZE: clamp(
    optionalInteger('SYNC_BLOCK_CHUNK_SIZE', 5),
    1,
    100,
    5
  ),
  SYNC_POLL_INTERVAL_MS: clamp(
    optionalInteger('SYNC_POLL_INTERVAL_MS', 1500),
    500,
    300000,
    1500
  ),

  RUN_INDEXER: optionalBoolean('RUN_INDEXER', false),

  RPC_MAX_CONCURRENCY: clamp(optionalInteger('RPC_MAX_CONCURRENCY', 4), 1, 20, 4),
  RPC_RETRY_ATTEMPTS: clamp(optionalInteger('RPC_RETRY_ATTEMPTS', 5), 0, 10, 5),
  RPC_RETRY_BASE_DELAY_MS: clamp(
    optionalInteger('RPC_RETRY_BASE_DELAY_MS', 1200),
    100,
    30000,
    1200
  ),
  RPC_OUT_OF_CREDITS_COOLDOWN_MS: clamp(
    optionalInteger('RPC_OUT_OF_CREDITS_COOLDOWN_MS', 60000),
    5000,
    900000,
    60000
  ),

  DB_AUTO_INDEX: optionalBoolean('DB_AUTO_INDEX', false),
  DB_MAX_POOL_SIZE: clamp(optionalInteger('DB_MAX_POOL_SIZE', 10), 1, 100, 10),
  DB_SERVER_SELECTION_TIMEOUT_MS: clamp(
    optionalInteger('DB_SERVER_SELECTION_TIMEOUT_MS', 15000),
    1000,
    120000,
    15000
  ),
  DB_SOCKET_TIMEOUT_MS: clamp(
    optionalInteger('DB_SOCKET_TIMEOUT_MS', 45000),
    1000,
    300000,
    45000
  ),

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

  API_RATE_LIMIT_WINDOW_MS: clamp(
    optionalInteger('API_RATE_LIMIT_WINDOW_MS', 60000),
    1000,
    3600000,
    60000
  ),
  API_RATE_LIMIT_MAX: clamp(
    optionalInteger('API_RATE_LIMIT_MAX', 300),
    1,
    100000,
    300
  ),

  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
};

const rpcUrls = [
  env.RPC_URL_1,
  env.RPC_URL_2,
  env.RPC_URL_3,
  env.RPC_URL,
].filter((value, index, arr) => value && arr.indexOf(value) === index);

if (rpcUrls.length === 0) {
  throw new Error(
    'Missing RPC configuration: provide at least one of RPC_URL_1, RPC_URL_2, RPC_URL_3, or RPC_URL'
  );
}

env.RPC_URLS = rpcUrls;

export default env;













// ======================================
// SECOND VERSION
// =======================================
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

// function optionalNumber(name, fallback) {
//   const raw = optional(name, String(fallback));
//   const num = Number(raw);
//   if (!Number.isFinite(num)) return Number(fallback);
//   return num;
// }

// function optionalInteger(name, fallback) {
//   const num = optionalNumber(name, fallback);
//   return Number.isInteger(num) ? num : Number(fallback);
// }

// function optionalBoolean(name, fallback = false) {
//   const raw = optional(name, fallback ? 'true' : 'false').toLowerCase();
//   return raw === 'true' || raw === '1' || raw === 'yes';
// }

// function clamp(value, min, max, fallback) {
//   if (!Number.isFinite(value)) return fallback;
//   if (value < min) return min;
//   if (value > max) return max;
//   return value;
// }

// const env = {
//   NODE_ENV: optional('NODE_ENV', 'development'),
//   PORT: clamp(optionalInteger('PORT', 5000), 1, 65535, 5000),

//   MONGODB_URI: required('MONGODB_URI'),

//   CHAIN_ID: optionalInteger('CHAIN_ID', 80002),

//   // Multi-RPC support
//   RPC_URL_1: optional('RPC_URL_1'),
//   RPC_URL_2: optional('RPC_URL_2'),
//   RPC_URL_3: optional('RPC_URL_3'),

//   // Backward compatibility fallback
//   RPC_URL: optional('RPC_URL', ''),

//   WS_RPC_URL: optional('WS_RPC_URL', ''),

//   START_BLOCK: Math.max(0, optionalInteger('START_BLOCK', 0)),
//   START_BLOCK_REGISTRATION: Math.max(
//     0,
//     optionalInteger('START_BLOCK_REGISTRATION', 0)
//   ),
//   START_BLOCK_LEVEL_MANAGER: Math.max(
//     0,
//     optionalInteger('START_BLOCK_LEVEL_MANAGER', 0)
//   ),
//   START_BLOCK_P4_ORBIT: Math.max(0, optionalInteger('START_BLOCK_P4_ORBIT', 0)),
//   START_BLOCK_P12_ORBIT: Math.max(
//     0,
//     optionalInteger('START_BLOCK_P12_ORBIT', 0)
//   ),
//   START_BLOCK_P39_ORBIT: Math.max(
//     0,
//     optionalInteger('START_BLOCK_P39_ORBIT', 0)
//   ),

//   SYNC_CONFIRMATIONS: clamp(optionalInteger('SYNC_CONFIRMATIONS', 3), 0, 100, 3),
//   SYNC_BLOCK_CHUNK_SIZE: clamp(
//     optionalInteger('SYNC_BLOCK_CHUNK_SIZE', 3),
//     1,
//     100,
//     3
//   ),

//   // Allow fast testnet / near-real-time polling while still blocking nonsense values
//   SYNC_POLL_INTERVAL_MS: clamp(
//     optionalInteger('SYNC_POLL_INTERVAL_MS', 30000),
//     500,
//     300000,
//     30000
//   ),

//   RUN_INDEXER: optionalBoolean('RUN_INDEXER', false),

//   RPC_MAX_CONCURRENCY: clamp(optionalInteger('RPC_MAX_CONCURRENCY', 3), 1, 20, 3),
//   RPC_RETRY_ATTEMPTS: clamp(optionalInteger('RPC_RETRY_ATTEMPTS', 4), 0, 10, 4),
//   RPC_RETRY_BASE_DELAY_MS: clamp(
//     optionalInteger('RPC_RETRY_BASE_DELAY_MS', 1500),
//     100,
//     30000,
//     1500
//   ),

//   // Extra cooldown for exhausted providers like 402 / Out of CU
//   RPC_OUT_OF_CREDITS_COOLDOWN_MS: clamp(
//     optionalInteger('RPC_OUT_OF_CREDITS_COOLDOWN_MS', 60000),
//     1000,
//     900000,
//     60000
//   ),

//   DB_AUTO_INDEX: optionalBoolean('DB_AUTO_INDEX', false),
//   DB_MAX_POOL_SIZE: clamp(optionalInteger('DB_MAX_POOL_SIZE', 10), 1, 100, 10),
//   DB_SERVER_SELECTION_TIMEOUT_MS: clamp(
//     optionalInteger('DB_SERVER_SELECTION_TIMEOUT_MS', 15000),
//     1000,
//     120000,
//     15000
//   ),
//   DB_SOCKET_TIMEOUT_MS: clamp(
//     optionalInteger('DB_SOCKET_TIMEOUT_MS', 45000),
//     1000,
//     300000,
//     45000
//   ),

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
//   ADMIN_API_HEADER: optional('ADMIN_API_HEADER', 'x-admin-key'),

//   API_RATE_LIMIT_WINDOW_MS: clamp(
//     optionalInteger('API_RATE_LIMIT_WINDOW_MS', 60000),
//     1000,
//     3600000,
//     60000
//   ),
//   API_RATE_LIMIT_MAX: clamp(
//     optionalInteger('API_RATE_LIMIT_MAX', 300),
//     1,
//     100000,
//     300
//   ),

//   LOG_LEVEL: optional('LOG_LEVEL', 'info'),
// };

// const rpcUrls = [
//   env.RPC_URL_1,
//   env.RPC_URL_2,
//   env.RPC_URL_3,
//   env.RPC_URL,
// ].filter((value, index, arr) => value && arr.indexOf(value) === index);

// if (rpcUrls.length === 0) {
//   throw new Error(
//     'Missing RPC configuration: provide at least one of RPC_URL_1, RPC_URL_2, RPC_URL_3, or RPC_URL'
//   );
// }

// env.RPC_URLS = rpcUrls;

// export default env;











// ====================================
  // FIRST VERSION
//======================================

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

// function optionalNumber(name, fallback) {
//   const raw = optional(name, String(fallback));
//   const num = Number(raw);
//   if (!Number.isFinite(num)) return Number(fallback);
//   return num;
// }

// function optionalInteger(name, fallback) {
//   const num = optionalNumber(name, fallback);
//   return Number.isInteger(num) ? num : Number(fallback);
// }

// function optionalBoolean(name, fallback = false) {
//   const raw = optional(name, fallback ? 'true' : 'false').toLowerCase();
//   return raw === 'true' || raw === '1' || raw === 'yes';
// }

// function clamp(value, min, max, fallback) {
//   if (!Number.isFinite(value)) return fallback;
//   if (value < min) return min;
//   if (value > max) return max;
//   return value;
// }

// const env = {
//   NODE_ENV: optional('NODE_ENV', 'development'),
//   PORT: clamp(optionalInteger('PORT', 5000), 1, 65535, 5000),

//   MONGODB_URI: required('MONGODB_URI'),

//   CHAIN_ID: optionalInteger('CHAIN_ID', 80002),

//   // Multi-RPC support
//   RPC_URL_1: optional('RPC_URL_1'),
//   RPC_URL_2: optional('RPC_URL_2'),
//   RPC_URL_3: optional('RPC_URL_3'),

//   // Backward compatibility fallback
//   RPC_URL: optional('RPC_URL', ''),

//   WS_RPC_URL: optional('WS_RPC_URL', ''),
//   START_BLOCK: Math.max(0, optionalInteger('START_BLOCK', 0)),

//   START_BLOCK_REGISTRATION: Math.max(0, optionalInteger('START_BLOCK_REGISTRATION', 0)),
//   START_BLOCK_LEVEL_MANAGER: Math.max(0, optionalInteger('START_BLOCK_LEVEL_MANAGER', 0)),
//   START_BLOCK_P4_ORBIT: Math.max(0, optionalInteger('START_BLOCK_P4_ORBIT', 0)),
//   START_BLOCK_P12_ORBIT: Math.max(0, optionalInteger('START_BLOCK_P12_ORBIT', 0)),
//   START_BLOCK_P39_ORBIT: Math.max(0, optionalInteger('START_BLOCK_P39_ORBIT', 0)),

//   SYNC_CONFIRMATIONS: clamp(optionalInteger('SYNC_CONFIRMATIONS', 3), 0, 100, 3),
//   SYNC_BLOCK_CHUNK_SIZE: clamp(optionalInteger('SYNC_BLOCK_CHUNK_SIZE', 3), 1, 100, 3),
//   SYNC_POLL_INTERVAL_MS: clamp(optionalInteger('SYNC_POLL_INTERVAL_MS', 30000), 5000, 300000, 30000),

//   RUN_INDEXER: optionalBoolean('RUN_INDEXER', false),

//   RPC_MAX_CONCURRENCY: clamp(optionalInteger('RPC_MAX_CONCURRENCY', 3), 1, 20, 3),
//   RPC_RETRY_ATTEMPTS: clamp(optionalInteger('RPC_RETRY_ATTEMPTS', 4), 0, 10, 4),
//   RPC_RETRY_BASE_DELAY_MS: clamp(optionalInteger('RPC_RETRY_BASE_DELAY_MS', 1500), 100, 30000, 1500),

//   DB_AUTO_INDEX: optionalBoolean('DB_AUTO_INDEX', false),
//   DB_MAX_POOL_SIZE: clamp(optionalInteger('DB_MAX_POOL_SIZE', 10), 1, 100, 10),
//   DB_SERVER_SELECTION_TIMEOUT_MS: clamp(
//     optionalInteger('DB_SERVER_SELECTION_TIMEOUT_MS', 15000),
//     1000,
//     120000,
//     15000
//   ),
//   DB_SOCKET_TIMEOUT_MS: clamp(
//     optionalInteger('DB_SOCKET_TIMEOUT_MS', 45000),
//     1000,
//     300000,
//     45000
//   ),

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
//   ADMIN_API_HEADER: optional('ADMIN_API_HEADER', 'x-admin-key'),

//   API_RATE_LIMIT_WINDOW_MS: clamp(
//     optionalInteger('API_RATE_LIMIT_WINDOW_MS', 60000),
//     1000,
//     3600000,
//     60000
//   ),
//   API_RATE_LIMIT_MAX: clamp(optionalInteger('API_RATE_LIMIT_MAX', 300), 1, 100000, 300),
//   LOG_LEVEL: optional('LOG_LEVEL', 'info'),
// };

// const rpcUrls = [
//   env.RPC_URL_1,
//   env.RPC_URL_2,
//   env.RPC_URL_3,
//   env.RPC_URL,
// ].filter((value, index, arr) => value && arr.indexOf(value) === index);

// if (rpcUrls.length === 0) {
//   throw new Error('Missing RPC configuration: provide at least one of RPC_URL_1, RPC_URL_2, RPC_URL_3, or RPC_URL');
// }

// env.RPC_URLS = rpcUrls;

// export default env;
