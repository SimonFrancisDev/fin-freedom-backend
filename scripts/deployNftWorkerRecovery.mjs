// Only the named production worker is mutable. Environment updates are per-key,
// never bulk replacement. Secrets remain in memory and are never printed.
import fs from 'node:fs';
import { Wallet } from 'ethers';
const worker = 'srv-d7eit4favr4c73c08t8g';
const reportPath = 'reports/nft-worker-rollout-2026-11-02.json';
const expectedReplacement = '0xfFe24eD92941c30832fAcC60dabfd13608062DCa';
const expectedRpc = 'https://sleek-floral-sunset.matic.quiknode.pro/1460df1a491dc403da3e8d7ca26a1129435c2f37/';
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
async function request(path, method = 'GET', body) {
  const response = await fetch(`https://api.render.com/v1${path}`, { method,
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY_TEMP}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Render ${method} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function readEnvironment() {
  const result = new Map();
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const rows = await request(`/services/${worker}/env-vars?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!Array.isArray(rows)) throw new Error('Unexpected environment response');
    for (const row of rows) {
      if (typeof row.envVar?.key !== 'string' || typeof row.envVar.value !== 'string') throw new Error('Unexpected environment entry');
      result.set(row.envVar.key, row.envVar.value);
    }
    if (rows.length < 100) return result;
    const next = rows.at(-1)?.cursor;
    if (!next || next === cursor) throw new Error('Environment pagination incomplete');
    cursor = next;
  }
  throw new Error('Environment pagination limit exceeded');
}
function save() {
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
try {
  const service = await request(`/services/${worker}`);
  if (service.name !== 'fin-freedom-backend-4(bg_worker)' || service.branch !== 'main'
      || !service.repo?.endsWith('/SimonFrancisDev/fin-freedom-backend') && !service.repo?.endsWith('/SimonFrancisDev/fin-freedom-backend.git')) {
    throw new Error('Production worker repository binding mismatch');
  }
  const before = await readEnvironment();
  if (before.get('CHAIN_ID') !== '137' || before.get('RUN_INDEXER') !== 'true'
      || before.get('NFT_AUTO_DISTRIBUTION_ENABLED') !== 'true'
      || before.get('FREEDOM_NFT_REWARD_DISTRIBUTOR_ADDRESS')?.toLowerCase() !== '0xd3b9637281c41fc7575af34d5e63c4de2d86c838'
      || !(before.get('MONGODB_URI') || before.get('MONGO_URI'))) throw new Error('Production worker configuration mismatch');
  report.serviceId = worker;
  report.checkedAt = new Date().toISOString();
  report.environmentCount = before.size;
  report.operatorBefore = new Wallet(before.get('NFT_REWARD_OPERATOR_PRIVATE_KEY')).address;
  report.rpcHostsBefore = ['RPC_URL_1', 'RPC_URL_2', 'RPC_URL_3', 'RPC_URL']
    .filter((key) => before.get(key)).map((key) => ({ key, host: new URL(before.get(key)).hostname }));
  if (process.argv.includes('--configure')) {
    const key = process.env.NFT_REPLACEMENT_KEY;
    if (new Wallet(key).address !== expectedReplacement) throw new Error('Wrong replacement operator');
    const changes = new Map([['NFT_REWARD_OPERATOR_PRIVATE_KEY', key], ['RPC_URL_1', expectedRpc]]);
    // The worker previously duplicated the same failing HTTP endpoint in slot 2.
    if (before.get('RPC_URL_2') === 'https://boldest-tame-waterfall.matic.quiknode.pro/fa63c1cd095f07f3d7876ea5d2bfa6b798d35e8a/') {
      changes.set('RPC_URL_2', expectedRpc);
    }
    for (const [name, value] of changes) {
      if (before.get(name) !== value) await request(`/services/${worker}/env-vars/${name}`, 'PUT', { value });
    }
    const after = await readEnvironment();
    for (const [name, value] of before) {
      if (!changes.has(name) && after.get(name) !== value) throw new Error(`Unrelated environment changed: ${name}`);
    }
    for (const [name, value] of changes) if (after.get(name) !== value) throw new Error(`Environment update not retained: ${name}`);
    report.configured = true;
    report.updatedKeys = [...changes.keys()];
    report.unrelatedEnvironmentPreserved = true;
    report.operatorAfter = new Wallet(after.get('NFT_REWARD_OPERATOR_PRIVATE_KEY')).address;
    save();
  }
  const sha = process.env.NFT_DEPLOY_COMMIT;
  const deploys = await request(`/services/${worker}/deploys?limit=10`);
  if (!Array.isArray(deploys)) throw new Error('Unexpected deployments response');
  report.deploys = deploys.map(({ deploy }) => ({ id: deploy.id, status: deploy.status, commit: deploy.commit?.id }));
  if (process.argv.includes('--deploy')) {
    if (!report.configured || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Configuration and exact commit required');
    let deploy = deploys.find(({ deploy: item }) => item.commit?.id === sha && !['build_failed', 'update_failed', 'canceled', 'deactivated'].includes(item.status))?.deploy;
    if (!deploy) deploy = await request(`/services/${worker}/deploys`, 'POST', { commitId: sha, clearCache: 'do_not_clear' });
    report.deployment = { id: deploy.id, status: deploy.status, commit: deploy.commit?.id || sha };
  }
  save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]'));
  process.exitCode = 1;
}
