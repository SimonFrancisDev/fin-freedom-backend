import express from 'express';
import {
  clearOneNotification,
  clearRead,
  getNotificationDetail,
  getNotificationFeed,
  getNotificationPreferences,
  patchNotificationPreferences,
  readAllNotifications,
  readNotification,
} from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', getNotificationFeed);
router.get('/preferences', getNotificationPreferences);
router.patch('/preferences', patchNotificationPreferences);
router.patch('/read-all', readAllNotifications);
router.patch('/clear-read', clearRead);
router.get('/:id', getNotificationDetail);
router.patch('/:id/read', readNotification);
router.patch('/:id/clear', clearOneNotification);

export default router;
