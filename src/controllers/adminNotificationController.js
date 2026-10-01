import {
  createSystemNotification,
  getNotificationHealth,
  listDeliveryAttempts,
} from '../services/notifications/notificationService.js';
import { processTelegramDeliveryQueue } from '../services/notifications/telegramService.js';
import { sendAdminMessage } from '../services/notifications/adminMessageService.js';
import { storeNotificationImage } from '../services/notifications/notificationMediaService.js';

function sendError(res, error) {
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Admin notification request failed',
  });
}

export async function createAdminSystemNotification(req, res) {
  try {
    const notification = await createSystemNotification(req.body || {});
    res.status(201).json({ ok: true, notification });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getAdminNotificationHealth(req, res) {
  try {
    res.json(await getNotificationHealth());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getAdminDeliveryAttempts(req, res) {
  try {
    res.json(await listDeliveryAttempts(req.query));
  } catch (error) {
    sendError(res, error);
  }
}

export async function retryAdminNotification(req, res) {
  try {
    const result = await processTelegramDeliveryQueue({ limit: 25 });
    res.json({ ok: true, notificationId: req.params.id, delivery: result });
  } catch (error) {
    sendError(res, error);
  }
}

export async function sendAdminNotificationMessage(req, res) {
  try {
    const result = await sendAdminMessage(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}

export async function uploadAdminNotificationImage(req, res) {
  try {
    const image = await storeNotificationImage({
      buffer: req.body,
      contentType: req.get('content-type'),
      filename: req.get('x-file-name') || 'notification-image',
    });
    res.status(201).json({
      ok: true,
      image: {
        ...image,
        url: `/api/notifications/media/${image.id}`,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
}