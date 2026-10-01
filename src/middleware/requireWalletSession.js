import { getProfileSessionFromRequest } from '../services/profilePrivacyService.js';

export function requireWalletSession(req, res, next) {
  const session = getProfileSessionFromRequest(req);
  if (!session?.walletAddress) {
    return res.status(401).json({ ok: false, message: 'Wallet authorization is required' });
  }
  req.walletSession = session;
  next();
}
