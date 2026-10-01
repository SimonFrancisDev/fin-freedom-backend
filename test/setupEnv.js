import { fileURLToPath } from 'node:url';

// Tests must never inherit a developer's live database or RPC credentials.
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: fileURLToPath(new URL('./.no-live-env', import.meta.url)),
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:1/isolated-tests',
  RPC_URL: 'http://127.0.0.1:1',
  RPC_URL_1: 'http://127.0.0.1:1',
  RPC_URL_2: '', RPC_URL_3: '',
  WS_RPC_URL: '', WS_RPC_URL_1: 'ws://127.0.0.1:1', WS_RPC_URL_2: '', WS_RPC_URL_3: '',
  RUN_INDEXER: 'false', FREEDOM_PLUS_ENABLED: 'false',
});
for (const [index, key] of [
  'USDT_ADDRESS', 'ESCROW_ADDRESS', 'REGISTRATION_ADDRESS',
  'LEVEL_MANAGER_ADDRESS', 'P4_ORBIT_ADDRESS', 'P12_ORBIT_ADDRESS', 'P39_ORBIT_ADDRESS',
].entries()) {
  process.env[key] = '0x' + (index + 1).toString(16).padStart(40, '0');
}
