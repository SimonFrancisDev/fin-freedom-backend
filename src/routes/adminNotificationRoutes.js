import express from 'express';
import {
  createAdminSystemNotification,
  getAdminDeliveryAttempts,
  getAdminNotificationHealth,
  retryAdminNotification,
} from '../controllers/adminNotificationController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = express.Router();

router.use(requireAdmin);
router.post('/system', createAdminSystemNotification);
router.get('/health', getAdminNotificationHealth);
router.get('/delivery-attempts', getAdminDeliveryAttempts);
router.post('/:id/retry', retryAdminNotification);

export default router;
