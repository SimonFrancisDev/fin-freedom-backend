import express from 'express';
import {
  getProfilePrivacyStatus,
  updateProfilePrivacyStatus,
} from '../controllers/profilePrivacyController.js';

const router = express.Router();

router.get('/:address', getProfilePrivacyStatus);
router.patch('/:address', updateProfilePrivacyStatus);

export default router;
