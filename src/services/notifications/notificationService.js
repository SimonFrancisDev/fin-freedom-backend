import env from '../../config/env.js';
import Notification from '../../models/Notification.js';
import NotificationPreference from '../../models/NotificationPreference.js';
import NotificationDeliveryAttempt from '../../models/NotificationDeliveryAttempt.js';
import {
  mapIndexedEscrowEventToNotifications,
  mapIndexedFinancialEventToNotifications,
  mapIndexedReceiptToNotifications,
  mapIndexedTokenEventToNotifications,
} from './notificationMapper.js';
import { dispatchTelegramNotification, reportAdminTelegramAlert } from './telegramService.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function normalizeWallet(wallet) {
  return String(wallet || '').trim().toLowerCase();
}

function retentionDate() {
  return new Date(Date.now() + env.NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function dedupeKeyFor(input) {
  if (input.dedupeKey) return input.dedupeKey;
  const txHash = input.txHash || 'no-tx';
  const logIndex = input.logIndex ?? 'no-log';
  return `${input.chainId}:${txHash}:${logIndex}:${input.notificationType}`;
}

function preferenceKeyForNotification(type = '') {
  const map = {
    payment_received: 'paymentReceived',
    payment_skipped: 'paymentSkipped',
    escrow_locked: 'escrow',
    escrow_used: 'escrow',
    escrow_released: 'escrow',
    auto_upgrade_completed: 'autoUpgrade',
    recycle_completed: 'recycle',
    token_reward_eligibility: 'tokenRewards',
    token_reward_minted: 'tokenRewards',
    system_notice: 'systemNotices',
    community_notice: 'communityNotices',
  };
  return map[type] || '';
}

function webPreferenceAllows(notification, preferences) {
  const preferenceKey = preferenceKeyForNotification(notification.notificationType);
  if (!preferenceKey) return true;
  return preferences?.web?.[preferenceKey] !== false;
}

export async function upsertNotification(input) {
  if (!env.NOTIFICATIONS_ENABLED) return null;
  const walletAddress = normalizeWallet(input.walletAddress);
  if (!walletAddress) return null;

  const doc = {
    ...input,
    walletAddress,
    dedupeKey: dedupeKeyFor(input),
    expiresAt: input.expiresAt || retentionDate(),
  };

  const result = await Notification.updateOne(
    { dedupeKey: doc.dedupeKey },
    { $setOnInsert: doc },
    { upsert: true }
  );

  const notification = await Notification.findOne({ dedupeKey: doc.dedupeKey });
  if (result.upsertedCount > 0 && notification) {
    dispatchTelegramNotification(notification).catch((error) => {
      console.error('[NOTIFICATION_TELEGRAM_DISPATCH_FAILED]', error?.message || String(error));
    });
  }

  return notification;
}

async function createMappedNotifications(items) {
  for (const item of items.filter(Boolean)) {
    try {
      await upsertNotification(item);
    } catch (error) {
      console.error('[NOTIFICATION_CREATE_FAILED]', {
        type: item.notificationType,
        txHash: item.txHash,
        logIndex: item.logIndex,
        error: error?.message || String(error),
      });
    }
  }
}

export async function notifyFromIndexedReceipt(event) {
  return createMappedNotifications(await mapIndexedReceiptToNotifications(event));
}

export async function notifyFromIndexedEscrowEvent(event) {
  return createMappedNotifications(await mapIndexedEscrowEventToNotifications(event));
}

export async function notifyFromIndexedFinancialEvent(event) {
  return createMappedNotifications(await mapIndexedFinancialEventToNotifications(event));
}

export async function notifyFromIndexedTokenEvent(event) {
  return createMappedNotifications(mapIndexedTokenEventToNotifications(event));
}

export async function createSystemNotification({
  walletAddress,
  audience = '',
  titleKey = 'notifications.system_notice.title',
  messageKey = 'notifications.system_notice.message',
  detailKey = 'notifications.system_notice.detail',
  i18nParams = {},
  severity = 'info',
  route = 'dashboard',
  source = 'admin',
  notificationType = 'system_notice',
}) {
  const normalizedWallet = normalizeWallet(walletAddress);
  const dedupeKey = `${source}:${notificationType}:${audience || normalizedWallet}:${Date.now()}`;
  return upsertNotification({
    walletAddress: normalizedWallet,
    chainId: env.CHAIN_ID,
    notificationType,
    severity,
    source,
    titleKey,
    messageKey,
    detailKey,
    i18nParams,
    route,
    dedupeKey,
  });
}

export async function createAdminIndexerWarning(payload = {}) {
  await reportAdminTelegramAlert('admin_indexer_warning', payload);
}

export async function listNotifications(query = {}) {
  const walletAddress = normalizeWallet(query.wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }

  const filter = { walletAddress };
  if (query.status) filter.status = query.status;
  else filter.status = { $ne: 'cleared' };
  if (query.type) filter.notificationType = query.type;
  if (query.severity) filter.severity = query.severity;
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const [rows, preferences] = await Promise.all([
    Notification.find(filter)
    .sort({ createdAt: -1, _id: -1 })
      .limit(limit * 3)
      .lean(),
    NotificationPreference.findOne({ walletAddress }).lean(),
  ]);

  const filteredRows = rows.filter((item) => webPreferenceAllows(item, preferences));
  const hasMore = filteredRows.length > limit;
  const items = hasMore ? filteredRows.slice(0, limit) : filteredRows;

  return {
    ok: true,
    items,
    nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString?.() : null,
  };
}

export async function getNotificationById(id, wallet) {
  const walletAddress = normalizeWallet(wallet);
  const notification = await Notification.findOne({ _id: id, walletAddress }).lean();
  if (!notification) {
    const error = new Error('Notification not found');
    error.status = 404;
    throw error;
  }
  return { ok: true, notification };
}

export async function markNotificationRead(id, wallet) {
  const walletAddress = normalizeWallet(wallet);
  const notification = await Notification.findOneAndUpdate(
    { _id: id, walletAddress },
    { $set: { status: 'read', readAt: new Date() } },
    { new: true }
  ).lean();
  if (!notification) {
    const error = new Error('Notification not found');
    error.status = 404;
    throw error;
  }
  return { ok: true, notification };
}

export async function markAllNotificationsRead(wallet) {
  const walletAddress = normalizeWallet(wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }
  await Notification.updateMany(
    { walletAddress, status: 'unread' },
    { $set: { status: 'read', readAt: new Date() } }
  );
  return { ok: true };
}

export async function clearNotification(id, wallet) {
  const walletAddress = normalizeWallet(wallet);
  await Notification.updateOne(
    { _id: id, walletAddress },
    { $set: { status: 'cleared', clearedAt: new Date() } }
  );
  return { ok: true };
}

export async function clearReadNotifications(wallet) {
  const walletAddress = normalizeWallet(wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }
  await Notification.updateMany(
    { walletAddress, status: 'read' },
    { $set: { status: 'cleared', clearedAt: new Date() } }
  );
  return { ok: true };
}

export async function clearAllNotifications(wallet) {
  const walletAddress = normalizeWallet(wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }
  await Notification.updateMany(
    { walletAddress, status: { $ne: 'cleared' } },
    { $set: { status: 'cleared', clearedAt: new Date() } }
  );
  return { ok: true };
}

export async function getPreferences(wallet) {
  const walletAddress = normalizeWallet(wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }
  const preferences = await NotificationPreference.findOneAndUpdate(
    { walletAddress },
    { $setOnInsert: { walletAddress } },
    { upsert: true, new: true }
  ).lean();
  return { ok: true, preferences };
}

export async function updatePreferences(wallet, body = {}) {
  const walletAddress = normalizeWallet(wallet);
  if (!walletAddress) {
    const error = new Error('Wallet address is required');
    error.status = 400;
    throw error;
  }

  const update = {};
  if (typeof body.language === 'string') update.language = body.language;
  if (typeof body.telegramEnabled === 'boolean') update.telegramEnabled = body.telegramEnabled;
  if (typeof body.digestEnabled === 'boolean') update.digestEnabled = body.digestEnabled;

  for (const channel of ['web', 'telegram']) {
    if (body[channel] && typeof body[channel] === 'object') {
      for (const [key, value] of Object.entries(body[channel])) {
        if (typeof value === 'boolean') update[`${channel}.${key}`] = value;
      }
    }
  }

  const preferences = await NotificationPreference.findOneAndUpdate(
    { walletAddress },
    { $set: update, $setOnInsert: { walletAddress } },
    { upsert: true, new: true }
  ).lean();

  return { ok: true, preferences };
}

export async function getNotificationHealth() {
  const [total, unread, deliveryFailures] = await Promise.all([
    Notification.countDocuments(),
    Notification.countDocuments({ status: 'unread' }),
    NotificationDeliveryAttempt.countDocuments({ status: 'failed' }),
  ]);

  return {
    ok: true,
    enabled: env.NOTIFICATIONS_ENABLED,
    telegramEnabled: env.TELEGRAM_ENABLED,
    total,
    unread,
    deliveryFailures,
  };
}

export async function listDeliveryAttempts(query = {}) {
  const status = query.status || undefined;
  const filter = status ? { status } : {};
  const items = await NotificationDeliveryAttempt.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return { ok: true, items };
}
