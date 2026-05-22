import {
  clearAllNotifications,
  clearNotification,
  clearReadNotifications,
  getNotificationById,
  getPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updatePreferences,
} from '../services/notifications/notificationService.js';

function sendError(res, error) {
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Notification request failed',
  });
}

function walletFrom(req) {
  return req.query.wallet || req.body.wallet || req.params.wallet || '';
}

export async function getNotificationFeed(req, res) {
  try {
    res.json(await listNotifications(req.query));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getNotificationDetail(req, res) {
  try {
    res.json(await getNotificationById(req.params.id, walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function readNotification(req, res) {
  try {
    res.json(await markNotificationRead(req.params.id, walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function readAllNotifications(req, res) {
  try {
    res.json(await markAllNotificationsRead(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearOneNotification(req, res) {
  try {
    res.json(await clearNotification(req.params.id, walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearRead(req, res) {
  try {
    res.json(await clearReadNotifications(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearAll(req, res) {
  try {
    res.json(await clearAllNotifications(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getNotificationPreferences(req, res) {
  try {
    res.json(await getPreferences(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function patchNotificationPreferences(req, res) {
  try {
    res.json(await updatePreferences(walletFrom(req), req.body));
  } catch (error) {
    sendError(res, error);
  }
}
