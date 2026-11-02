import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('NFT payouts and shutdown handlers are not blocked by indexer startup recovery', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = server.indexOf('    startNftRewardDistributionWorker();');
  assert.ok(start > server.indexOf('    await connectDB();'));
  assert.ok(start > server.indexOf("    process.on('SIGTERM'"));
  assert.ok(start < server.indexOf('      await startRealtimeEventIndexer()'));
  assert.ok(start < server.indexOf('      await startFreedomPlusIndexer('));
  assert.equal(server.match(/startNftRewardDistributionWorker\(\);/g).length, 1);
});
