import express from 'express';
import { getOrCreateReferralCode, resolveReferralCode } from '../controllers/referralController.js';
import {
  lockReferral,
  getReferralLock,
} from '../controllers/referralAttributionController.js'

const router = express.Router();

router.get('/code/:address', getOrCreateReferralCode);
router.get('/resolve/:shortCode', resolveReferralCode);
router.post('/lock', lockReferral)
router.get('/lock', getReferralLock)

export default router;