import { isAddress } from 'ethers';
import env from '../../config/env.js';
import FreedomPlusParticipant from '../../models/FreedomPlusParticipant.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import { createSystemNotification } from './notificationService.js';
import { findNotificationImage } from './notificationMediaService.js';

const MAX_BROADCAST_RECIPIENTS = 10000;
const SEVERITIES = new Set(['info', 'success', 'warning', 'danger', 'critical']);

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${label} must be ${maxLength} characters or fewer`);
    error.status = 400;
    throw error;
  }
  return text;
}

async function registeredWallets() {
  const [freedomWallets, freedomPlusWallets] = await Promise.all([
    IndexedRegistrationEvent.distinct('user', {
      chainId: env.CHAIN_ID,
      user: { $ne: '' },
    }),
    FreedomPlusParticipant.distinct('wallet', {
      chainId: env.CHAIN_ID,
      registered: true,
      wallet: { $ne: '' },
    }),
  ]);

  return [...new Set([...freedomWallets, ...freedomPlusWallets]
    .map((wallet) => String(wallet || '').trim().toLowerCase())
    .filter((wallet) => isAddress(wallet)))]
    .slice(0, MAX_BROADCAST_RECIPIENTS);
}

export async function sendAdminMessage(input = {}) {
  if (!env.NOTIFICATIONS_ENABLED) {
    const error = new Error('Notifications are disabled. Set NOTIFICATIONS_ENABLED=true on the API service.');
    error.status = 503;
    throw error;
  }

  const deliveryMode = input.deliveryMode === 'broadcast' ? 'broadcast' : 'wallet';
  const title = requiredText(input.title, 'Title', 120);
  const message = requiredText(input.message, 'Message', 2000);
  const detail = String(input.detail || '').trim().slice(0, 2000);
  const severity = SEVERITIES.has(input.severity) ? input.severity : 'info';
  const route = String(input.route || 'notifications').trim().slice(0, 120);
  const imageId = String(input.imageId || '').trim();
  if (imageId && !(await findNotificationImage(imageId))) {
    const error = new Error('Notification image was not found');
    error.status = 400;
    throw error;
  }
  const imageUrl = imageId ? `/api/notifications/media/${imageId}` : '';

  let recipients;
  if (deliveryMode === 'broadcast') {
    recipients = await registeredWallets();
  } else {
    const walletAddress = String(input.walletAddress || '').trim();
    if (!isAddress(walletAddress)) {
      const error = new Error('A valid recipient wallet is required');
      error.status = 400;
      throw error;
    }
    recipients = [walletAddress.toLowerCase()];
  }

  if (!recipients.length) {
    const error = new Error('No indexed registered recipients were found');
    error.status = 404;
    throw error;
  }

  const campaignId = `admin-message:${Date.now()}`;
  let delivered = 0;
  const failures = [];

  for (const walletAddress of recipients) {
    try {
      const notification = await createSystemNotification({
        walletAddress,
        audience: deliveryMode,
        titleKey: '',
        messageKey: '',
        detailKey: '',
        title,
        message,
        detail,
        imageId,
        imageUrl,
        severity,
        route,
        source: 'admin',
        notificationType: 'admin_notice',
        dedupeKey: `${campaignId}:${walletAddress}`,
      });
      if (!notification) {
        throw new Error('Notification was not persisted');
      }
      delivered += 1;
    } catch (error) {
      failures.push({ walletAddress, message: error?.message || 'Delivery failed' });
    }
  }

  return {
    ok: failures.length === 0,
    campaignId,
    deliveryMode,
    requested: recipients.length,
    delivered,
    failed: failures.length,
    failures: failures.slice(0, 25),
  };
}