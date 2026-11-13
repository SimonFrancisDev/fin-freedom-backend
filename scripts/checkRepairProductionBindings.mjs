// Read-only release evidence. Never emit credentials or database connection strings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const services = ['srv-d7eeof8sfn5c738thl60', 'srv-d7eit4favr4c73c08t8g'];
const report = { checkedAt: new Date().toISOString(), hostedWrites: 0, services: [] };
const expected = {
  REGISTRATION_ADDRESS: '0x02ECA97e944Ac66b0444fd5F61A716917E83CfF5',
  LEVEL_MANAGER_ADDRESS: '0x0E9De0F24eB4774834A2c4A63eaBa8356A4A4B53',
  FREEDOM_PLUS_REGISTRATION_ADDRESS: '0x7eC9D69fD82B1e62E01d497d495fEdfFfC34a0B6',
  FREEDOM_PLUS_LEVEL_MANAGER_ADDRESS: '0x6E59b6580826DCcC4c1c9E5497F6bE3BE9C77384',
  FREEDOM_PLUS_SETTLEMENT_ROUTER_ADDRESS: '0x8C88262595cbEAA5FffB60a0689b3EAbe22B0498',
  MULTISIG_ADDRESS: '0x785cC854ce9e13CE1140cbFD7C08620713E1711d',
};
async function get(route) {
  assert(process.env.RENDER_API_KEY_TEMP, 'Render credential required');
  const response = await fetch(`https://api.render.com/v1${route}`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY_TEMP}` }, signal: AbortSignal.timeout(45000),
  });
  assert(response.ok, `Render GET failed: ${response.status}`);
  return response.json();
}
for (const id of services) {
  const service = await get(`/services/${id}`);
  assert.equal(service.branch, 'main');
  assert.match(service.repo, /\/SimonFrancisDev\/fin-freedom-backend(?:\.git)?$/);
  assert.equal(service.suspended, 'not_suspended');
  const values = new Map();
  let cursor = '';
  for (let page = 0; ; page++) {
    assert(page < 10, 'Environment pagination exceeded');
    const rows = await get(`/services/${id}/env-vars?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert(Array.isArray(rows));
    for (const { envVar } of rows) {
      assert.equal(typeof envVar.key, 'string'); assert.equal(typeof envVar.value, 'string');
      assert(!values.has(envVar.key), 'Duplicate environment key');
      values.set(envVar.key, envVar.value);
    }
    if (rows.length < 100) break;
    const next = rows.at(-1).cursor;
    assert(next && next !== cursor); cursor = next;
  }
  assert.equal(values.get('CHAIN_ID'), '137');
  assert(values.get('MONGO_URI') || values.get('MONGODB_URI'), 'Database URI missing');
  for (const [key, value] of Object.entries(expected)) assert.equal(values.get(key)?.toLowerCase(), value.toLowerCase(), `${service.name}: ${key}`);
  const worker = id === services[1];
  assert.equal(values.get('RUN_INDEXER'), String(worker));
  assert.equal(values.get('NFT_AUTO_DISTRIBUTION_ENABLED'), String(worker));
  const flags = Object.fromEntries([...values].filter(([key]) => /^(RUN_INDEXER|.*INDEXER.*ENABLED|.*REALTIME.*ENABLED|NFT_AUTO_DISTRIBUTION_ENABLED|FREEDOM_PLUS_ENABLED)$/.test(key)));
  const deployments = await get(`/services/${id}/deploys?limit=5`);
  report.services.push({ id, name: service.name, keyCount: values.size, databaseUriPresent: true, flags,
    publicAddresses: Object.fromEntries(Object.keys(expected).map(key => [key, values.get(key)])),
    environmentFingerprint: createHash('sha256').update(JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b)))).digest('hex'),
    live: deployments.map(row => row.deploy).filter(row => row.status === 'live').map(row => ({ id: row.id, commit: row.commit?.id })),
  });
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
fs.writeFileSync(path.join(root, 'tmp/repair-render-environment-review.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
