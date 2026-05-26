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
import { requireWalletProof } from '../utils/walletProof.js';

function sendError(res, error) {
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Notification request failed',
  });
}

function walletFrom(req) {
  return req.query.wallet || req.body.wallet || req.params.wallet || '';
}

function requireNotificationWalletProof(req) {
  const wallet = walletFrom(req);
  return requireWalletProof({
    walletAddress: wallet,
    action: 'notification_manage',
    signature: req.body.signature,
    timestamp: req.body.timestamp,
  });
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
    requireNotificationWalletProof(req);
    res.json(await markNotificationRead(req.params.id, walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function readAllNotifications(req, res) {
  try {
    requireNotificationWalletProof(req);
    res.json(await markAllNotificationsRead(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearOneNotification(req, res) {
  try {
    requireNotificationWalletProof(req);
    res.json(await clearNotification(req.params.id, walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearRead(req, res) {
  try {
    requireNotificationWalletProof(req);
    res.json(await clearReadNotifications(walletFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
}

export async function clearAll(req, res) {
  try {
    requireNotificationWalletProof(req);
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
    requireNotificationWalletProof(req);
    res.json(await updatePreferences(walletFrom(req), req.body));
  } catch (error) {
    sendError(res, error);
  }
}
