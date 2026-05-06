import express from 'express';
import { getOrCreateReferralCode, resolveReferralCode } from '../controllers/referralController.js';

const router = express.Router();

router.get('/code/:address', getOrCreateReferralCode);
router.get('/resolve/:shortCode', resolveReferralCode);

export default router;