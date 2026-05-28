import express from 'express';
import {
  createProfilePrivacySession,
  getProfilePrivacyStatus,
  updateProfilePrivacyStatus,
} from '../controllers/profilePrivacyController.js';

const router = express.Router();

router.post('/session', createProfilePrivacySession);
router.get('/:address', getProfilePrivacyStatus);
router.patch('/:address', updateProfilePrivacyStatus);

export default router;
