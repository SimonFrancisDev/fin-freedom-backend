import express from 'express';
import {
  clearAll,
  clearOneNotification,
  clearRead,
  getNotificationDetail,
  getNotificationFeed,
  getNotificationPreferences,
  patchNotificationPreferences,
  readAllNotifications,
  readNotification,
} from '../controllers/notificationController.js';
import { getNotificationMedia } from '../controllers/notificationMediaController.js';

const router = express.Router();

router.get('/', getNotificationFeed);
router.get('/preferences', getNotificationPreferences);
router.get('/media/:id', getNotificationMedia);
router.patch('/preferences', patchNotificationPreferences);
router.patch('/read-all', readAllNotifications);
router.patch('/clear-read', clearRead);
router.patch('/clear-all', clearAll);
router.get('/:id', getNotificationDetail);
router.patch('/:id/read', readNotification);
router.patch('/:id/clear', clearOneNotification);

export default router;
