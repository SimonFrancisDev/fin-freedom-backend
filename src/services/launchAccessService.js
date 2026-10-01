import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export function launchConfiguration(source = process.env) {
  const enabled = source.NEW_FEATURE_LAUNCH_ENABLED === 'true';
  const launchAt = Date.parse(source.NEW_FEATURE_LAUNCH_AT || '');
  const secret = source.EARLY_ACCESS_SIGNING_SECRET || '';
  if (enabled && (!Number.isFinite(launchAt) || secret.length < 32)) {
    throw new Error('Launch requires a valid UTC timestamp and a signing secret of at least 32 characters');
  }
  return { enabled, launchAt, secret };
}

export function issueInvitation(config, now = Date.now()) {
  if (!config.enabled || now >= config.launchAt) throw new Error('Early access is not active');
  const payload = Buffer.from(JSON.stringify({ purpose: 'new-programs', id: randomUUID(),
    expiresAt: config.launchAt })).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function validInvitation(token, config, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048 || !config.secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = createHmac('sha256', config.secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return data.purpose === 'new-programs' && Number.isFinite(data.expiresAt)
      && data.expiresAt > now && data.expiresAt <= config.launchAt;
  } catch { return false; }
}

export function launchStatus(config, token, now = Date.now()) {
  const publicOpen = !config.enabled || now >= config.launchAt;
  return { enabled: config.enabled, publicOpen,
    authorized: publicOpen || validInvitation(token, config, now),
    serverNow: now, launchAt: config.enabled ? config.launchAt : null,
    bannerUntil: config.enabled ? config.launchAt + 7 * 86400000 : null };
}
