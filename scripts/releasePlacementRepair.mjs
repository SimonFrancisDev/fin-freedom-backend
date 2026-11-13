// Commit-specific deployment only. No environment, database or contract writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'tmp/repair-render-release.json');
const commit = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(commit || ''), 'Exact source commit required');
const ids = ['srv-d7eeof8sfn5c738thl60', 'srv-d7eit4favr4c73c08t8g'];
const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { commit, services: [] };
assert.equal(report.commit, commit, 'Existing release record belongs to another commit');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tmp/repair-render-environment-review.json'), 'utf8'));
async function request(route, body) {
  const res = await fetch(`https://api.render.com/v1${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY_TEMP}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
  });
  assert(res.ok, `Render request failed: ${res.status}`);
  return res.json();
}
for (const id of ids) {
  const service = await request(`/services/${id}`);
  assert.equal(service.branch, 'main'); assert.equal(service.suspended, 'not_suspended');
  assert.match(service.repo, /\/SimonFrancisDev\/fin-freedom-backend(?:\.git)?$/);
  assert(baseline.services.some(s => s.id === id && s.name === service.name && s.databaseUriPresent));
  let deployment = (await request(`/services/${id}/deploys?limit=10`)).map(r => r.deploy)
    .find(d => d.commit?.id === commit && !['build_failed', 'update_failed', 'canceled', 'deactivated'].includes(d.status));
  if (!deployment && process.argv.includes('--deploy')) deployment = await request(`/services/${id}/deploys`, { commitId: commit, clearCache: 'do_not_clear' });
  assert(deployment, 'No matching deployment; use --deploy to start the authorized production release');
  const record = { id, name: service.name, deployment: deployment.id, status: deployment.status,
    commit: deployment.commit?.id || commit, environmentFingerprintBefore: baseline.services.find(s => s.id === id).environmentFingerprint };
  assert.equal(record.commit, commit);
  report.services = [...report.services.filter(s => s.id !== id), record];
  report.checkedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
