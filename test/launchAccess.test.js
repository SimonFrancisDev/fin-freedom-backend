import test from 'node:test';
import assert from 'node:assert/strict';
import { launchConfiguration, launchStatus, issueInvitation, validInvitation } from '../src/services/launchAccessService.js';

const config = launchConfiguration({ NEW_FEATURE_LAUNCH_ENABLED: 'true',
  NEW_FEATURE_LAUNCH_AT: '2026-10-01T20:00:00Z', EARLY_ACCESS_SIGNING_SECRET: 'a'.repeat(32) });
test('new features open at exact launch boundary without an administrative action', () => {
  assert.equal(launchStatus(config, '', config.launchAt - 1).authorized, false);
  assert.equal(launchStatus(config, '', config.launchAt).publicOpen, true);
  assert.equal(launchStatus(config, '', config.launchAt).bannerUntil, config.launchAt + 604800000);
});
test('signed invitations expire at launch and reject tampering or another secret', () => {
  const now = config.launchAt - 1000;
  const token = issueInvitation(config, now);
  assert.equal(validInvitation(token, config, now), true);
  assert.equal(validInvitation(token, config, config.launchAt), false);
  assert.equal(validInvitation(token + 'x', config, now), false);
  assert.equal(validInvitation(token, { ...config, secret: 'b'.repeat(32) }, now), false);
  assert.equal(launchStatus(config, token, now).authorized, true);
});
test('disabled launch gating preserves existing staging access; invalid enabled config fails closed', () => {
  assert.equal(launchStatus(launchConfiguration({})).authorized, true);
  assert.throws(() => launchConfiguration({ NEW_FEATURE_LAUNCH_ENABLED: 'true' }));
  assert.throws(() => issueInvitation(config, config.launchAt));
});
