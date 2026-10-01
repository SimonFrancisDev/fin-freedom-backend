import express from 'express';
import {
  createAdminSystemNotification,
  getAdminDeliveryAttempts,
  getAdminNotificationHealth,
  retryAdminNotification,
  sendAdminNotificationMessage,
  uploadAdminNotificationImage,
} from '../controllers/adminNotificationController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = express.Router();

router.use(requireAdmin);
router.post('/system', createAdminSystemNotification);
router.post('/messages', sendAdminNotificationMessage);
router.post('/media', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), uploadAdminNotificationImage);
router.get('/health', getAdminNotificationHealth);
router.get('/delivery-attempts', getAdminDeliveryAttempts);
router.post('/:id/retry', retryAdminNotification);

export default router;
