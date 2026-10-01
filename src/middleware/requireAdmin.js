import env from '../config/env.js';
import crypto from 'crypto';
import { getProfileSessionFromRequest } from '../services/profilePrivacyService.js';

function isSameSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function requireAdmin(req, res, next) {
  try {
    const headerName = (env.ADMIN_API_HEADER || 'x-admin-key').toLowerCase();
    const providedKey = req.headers[headerName];

    const session = getProfileSessionFromRequest(req);
    const keyAuthorized = Boolean(env.ADMIN_API_KEY) && isSameSecret(providedKey, env.ADMIN_API_KEY);
    const stagingTestAuthorized =
      env.NODE_ENV === 'staging' &&
      env.STAGING_TEST_ADMIN_ENABLED &&
      Boolean(session?.walletAddress);

    if (!keyAuthorized && !stagingTestAuthorized) {
      return res.status(env.ADMIN_API_KEY ? 403 : 500).json({
        ok: false,
        message: env.ADMIN_API_KEY ? 'Admin access denied' : 'Admin protection is not configured',
      });
    }

    req.adminAccess = stagingTestAuthorized
      ? { mode: 'staging-wallet', walletAddress: session.walletAddress }
      : { mode: 'api-key', walletAddress: '' };
    next();
  } catch (error) {
    next(error);
  }
}
