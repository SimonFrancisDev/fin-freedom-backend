import env from '../config/env.js';
import crypto from 'crypto';

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

    if (!env.ADMIN_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: 'Admin protection is not configured',
      });
    }

    if (!isSameSecret(providedKey, env.ADMIN_API_KEY)) {
      return res.status(403).json({
        ok: false,
        message: 'Admin access denied',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
