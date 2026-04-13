import env from '../config/env.js';

export async function getHealth(req, res, next) {
  try {
    res.status(200).json({
      ok: true,
      service: 'finfreedom-backend',
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}