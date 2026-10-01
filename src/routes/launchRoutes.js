import express from 'express';
import env from '../config/env.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { launchConfiguration, launchStatus, issueInvitation } from '../services/launchAccessService.js';

const config = launchConfiguration();
const router = express.Router();
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(launchStatus(config, req.get('X-Early-Access')));
});
router.post('/invitations', requireAdmin, (req, res, next) => {
  try {
    const url = new URL('/freedom-plus', env.FRONTEND_ORIGIN);
    url.hash = `invite=${issueInvitation(config)}`;
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ url: url.toString(), expiresAt: config.launchAt });
  } catch (error) { next(error); }
});

export function requireNewFeatureAccess(req, res, next) {
  if (launchStatus(config, req.get('X-Early-Access')).authorized) return next();
  res.status(403).json({ ok: false, code: 'PRELAUNCH', message: 'Invitation required until public launch.' });
}
export default router;
