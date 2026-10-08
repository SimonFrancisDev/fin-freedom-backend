import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const indexerSource = await readFile(
  new URL('../src/services/freedomPlusIndexerService.js', import.meta.url),
  'utf8'
);
const querySource = await readFile(
  new URL('../src/services/read/freedomPlusQueryService.js', import.meta.url),
  'utf8'
);
const providerSource = await readFile(
  new URL('../src/blockchain/provider.js', import.meta.url),
  'utf8'
);
const realtimeSource = await readFile(
  new URL('../src/services/realtimeEventIndexer.js', import.meta.url),
  'utf8'
);
const contractsSource = await readFile(
  new URL('../src/blockchain/freedomPlusContracts.js', import.meta.url),
  'utf8'
);
const baseContractsSource = await readFile(
  new URL('../src/blockchain/contracts.js', import.meta.url),
  'utf8'
);
const syncQuerySource = await readFile(
  new URL('../src/services/read/syncQueryService.js', import.meta.url),
  'utf8'
);
const baseIndexerSource = await readFile(
  new URL('../src/services/indexerService.js', import.meta.url),
  'utf8'
);

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('realtime indexing does not start a periodic HTTP recovery scan', () => {
  const polling = functionBody(indexerSource, 'startFreedomPlusIndexer');
  const realtime = functionBody(indexerSource, 'startFreedomPlusRealtimeIndexer');

  assert.match(polling, /setInterval\(scheduledPass, env\.SYNC_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(realtime, /setInterval|SYNC_POLL_INTERVAL_MS/);
  assert.match(realtime, /startup-event-confirmation-reconnect/);
});

test('Freedom-Plus shares the F-Freedom WebSocket provider', () => {
  const shared = functionBody(indexerSource, 'startFreedomPlusSharedRealtimeIndexer');

  assert.doesNotMatch(shared, /new WebSocketProvider|connectFreedomPlusRealtime/);
  assert.match(shared, /mode: 'realtime-shared'/);
  assert.match(indexerSource, /export function notifyFreedomPlusRealtimeEvent/);
});

test('shared WebSocket reconnect requests confirmed Freedom-Plus catch-up', () => {
  const connect = functionBody(realtimeSource, 'connectRealtimeProvider');

  assert.match(connect, /const recoveringConnection = reconnecting/);
  assert.match(
    connect,
    /requestFreedomPlusConfirmedRecovery\('shared-websocket-reconnect'\)/
  );
  assert.match(indexerSource, /export function requestFreedomPlusConfirmedRecovery/);
});

test('shared WebSocket startup and reconnect request one-shot base catch-up', () => {
  const connect = functionBody(realtimeSource, 'connectRealtimeProvider');

  assert.match(connect, /runConfirmedIndexerRecovery\(\{/);
  assert.match(connect, /'websocket-startup'/);
  assert.match(connect, /'websocket-reconnect'/);
  assert.doesNotMatch(connect, /startIndexer|setInterval/);
  assert.match(baseIndexerSource, /export async function runConfirmedIndexerRecovery/);
  assert.match(baseIndexerSource, /return runIndexerPassGuarded\(reason\)/);
});

test('blockchain startup does not consume a second WebSocket connection', () => {
  const start = providerSource.indexOf('export async function connectBlockchain');
  const end = providerSource.indexOf('\n}', start) + 2;
  const connect = providerSource.slice(start, end);
  assert.doesNotMatch(connect, /ensureWsBlockSubscriptionStarted|ensureRealtimeProviders/);

  const preflight = realtimeSource.indexOf('await currentWsProvider.getBlockNumber()');
  const firstSubscription = realtimeSource.indexOf('await attachListener(');
  assert.ok(preflight >= 0 && preflight < firstSubscription);
});
test('Freedom-Plus catch-up scans all contract addresses once per block chunk', () => {
  const combined = functionBody(indexerSource, 'syncTargetsCombined');
  const once = functionBody(indexerSource, 'syncFreedomPlusOnce');

  assert.match(combined, /address: entries\.map/);
  assert.match(combined, /logs\.sort/);
  assert.match(combined, /FreedomPlusSyncState\.updateMany/);
  assert.doesNotMatch(once, /for \(const \[contractKey, contract\]/);
  assert.match(once, /syncTargetsCombined/);
});

test('HTTP rate limiting uses a serialized sliding-window gate', () => {
  const start = providerSource.indexOf('async function enforceRateLimit()');
  const end = providerSource.indexOf('\nfunction sleep(', start);
  const limiter = providerSource.slice(start, end);

  assert.match(limiter, /rateLimitTail/);
  assert.match(limiter, /lastCallTimestamps\.length < maxRps/);
  assert.match(limiter, /1000 - \(now - lastCallTimestamps\[0\]\)/);
});

test('contract verification retries rebind reads to the selected provider', () => {
  const start = contractsSource.indexOf('export async function verifyFreedomPlusContracts');
  const verification = contractsSource.slice(start);
  const baseStart = baseContractsSource.indexOf('export async function verifyContracts');
  const baseVerification = baseContractsSource.slice(baseStart);

  assert.notEqual(start, -1);
  assert.notEqual(baseStart, -1);
  assert.doesNotMatch(verification, /await contracts\.provider\.getCode/);
  assert.doesNotMatch(verification, /await contracts\[[^\]]+\]\.manager\(/);
  assert.doesNotMatch(verification, /await contract\.owner\(/);
  assert.doesNotMatch(verification, /safeRpcCall\(\(\) =>/);
  assert.doesNotMatch(baseVerification, /safeRequiredCall\([^\n]+, \(\) =>/);
  assert.match(verification, /safeRpcCall\(\(provider\) => provider\.getCode/);
  assert.match(verification, /contracts\.settlementRouter\.connect\(provider\)\.orbitByType/);
  assert.match(verification, /contract\.connect\(provider\)\.owner\(\)/);
  assert.match(baseVerification, /contracts\.levelManager\.connect\(provider\)\.owner\(\)/);
});

test('indexer status retries block reads with the selected provider', () => {
  assert.match(
    syncQuerySource,
    /safeRpcCall\(\(provider\) => provider\.getBlockNumber\(\)\)/
  );
  assert.doesNotMatch(syncQuerySource, /safeRpcCall\(\(\) => provider\.getBlockNumber/);
});

test('realtime reconciliation accepts quiet checkpoints at the latest indexed event', () => {
  assert.match(
    querySource,
    /requiredCheckpointBlock = realtimeMode \? latestEventBlock : checkpointFloor/
  );
  assert.match(
    querySource,
    /lastProcessedBlock \|\| 0\) >= requiredCheckpointBlock/
  );
});
