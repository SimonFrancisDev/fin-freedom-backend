import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/freedomPlusIndexerService.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function syncNftMembershipThrough(');
const end = source.indexOf('\nlet realtimeProvider', start);
assert.ok(start >= 0 && end > start);
const body = source.slice(start, end).replace('export ', '');

function harness(options = {}) {
  const scans = [];
  const env = { RUN_INDEXER: true, FREEDOM_PLUS_ENABLED: true, CHAIN_ID: 80002,
    FREEDOM_PLUS_START_BLOCK: 100, SYNC_CONFIRMATIONS: 2, SYNC_BLOCK_CHUNK_SIZE: 5, ...options.env };
  const provider = { getNetwork: async () => ({ chainId: options.chainId || 80002 }),
    getBlockNumber: async () => options.head || 1000 };
  const deps = { env, getProvider: () => provider, safeRpcCall: (fn) => fn(provider),
    FreedomPlusSyncState: { findOne: () => ({ lean: async () => ({ lastProcessedBlock: 110 }) }) },
    getFreedomPlusContractEntries: () => [['nftMembership', {}], ['registration', {}]],
    syncTargetsCombined: async (_p, chain, entries, through) => { scans.push({ chain, entries, through }); } };
  const run = new Function(...Object.keys(deps), 'let running = false;\n' + body + '\nreturn syncNftMembershipThrough;')(...Object.values(deps));
  return { run, scans };
}

test('catchup scans only NFT membership and at most ten chunks', async () => {
  const h = harness();
  await h.run(900);
  assert.equal(h.scans[0].through, 160);
  assert.deepEqual(h.scans[0].entries.map(([key]) => key), ['nftMembership']);
});
test('catchup respects confirmed head and cutoff', async () => {
  const h = harness({ head: 130 });
  await h.run(140);
  assert.equal(h.scans[0].through, 128);
  const cutoff = harness();
  await cutoff.run(120);
  assert.equal(cutoff.scans[0].through, 120);
});
test('API processes do not scan, and wrong chain is rejected', async () => {
  const api = harness({ env: { RUN_INDEXER: false } });
  await api.run(900);
  assert.equal(api.scans.length, 0);
  await assert.rejects(harness({ chainId: 137 }).run(900), /chain mismatch/);
});
