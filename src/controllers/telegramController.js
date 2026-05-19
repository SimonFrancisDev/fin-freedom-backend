import env from '../config/env.js';
import {
  getTelegramStatus,
  startTelegramLink,
  unsubscribeTelegram,
  updateTelegramPreferences,
  verifyTelegramLink,
} from '../services/notifications/telegramService.js';

function sendError(res, error) {
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Telegram request failed',
  });
}

export async function startTelegramLinkController(req, res) {
  try {
    res.json(await startTelegramLink(req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
}

export async function verifyTelegramLinkController(req, res) {
  try {
    res.json(await verifyTelegramLink(req.body || {}));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTelegramStatusController(req, res) {
  try {
    res.json(await getTelegramStatus(req.query.wallet));
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateTelegramPreferencesController(req, res) {
  try {
    res.json(await updateTelegramPreferences(req.body.wallet, req.body.preferences || {}));
  } catch (error) {
    sendError(res, error);
  }
}

export async function unsubscribeTelegramController(req, res) {
  try {
    res.json(await unsubscribeTelegram(req.body.wallet));
  } catch (error) {
    sendError(res, error);
  }
}

export async function telegramWebhookController(req, res) {
  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!env.TELEGRAM_ENABLED) {
    return res.status(202).json({ ok: true, ignored: true });
  }
  if (!env.TELEGRAM_WEBHOOK_SECRET || providedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(403).json({ ok: false, message: 'Telegram webhook denied' });
  }
  return res.status(202).json({ ok: true, received: true });
}
