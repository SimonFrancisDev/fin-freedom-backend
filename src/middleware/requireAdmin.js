import env from '../config/env.js';

export function requireAdmin(req, res, next) {
  try {
    const headerName = env.ADMIN_API_HEADER || 'x-admin-key';
    const providedKey = req.headers[headerName];

    if (!env.ADMIN_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: 'Admin protection is not configured',
      });
    }

    if (!providedKey || providedKey !== env.ADMIN_API_KEY) {
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