import {
  createProfileSession,
  getProfilePrivacy,
  updateProfilePrivacy,
} from '../services/profilePrivacyService.js';

export async function getProfilePrivacyStatus(req, res, next) {
  try {
    const data = await getProfilePrivacy(req.params.address);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function updateProfilePrivacyStatus(req, res, next) {
  try {
    const data = await updateProfilePrivacy({
      walletAddress: req.params.address,
      isLocked: req.body?.isLocked,
      signature: req.body?.signature,
      timestamp: req.body?.timestamp,
    });

    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function createProfilePrivacySession(req, res, next) {
  try {
    const data = createProfileSession({
      walletAddress: req.body?.walletAddress,
      signature: req.body?.signature,
      timestamp: req.body?.timestamp,
    });

    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}
