import crypto from 'crypto';
import env from '../../config/env.js';
import TelegramSubscription from '../../models/TelegramSubscription.js';
import NotificationDeliveryAttempt from '../../models/NotificationDeliveryAttempt.js';
import { normalizeWalletAddress, requireWalletProof } from '../../utils/walletProof.js';

function isTelegramReady() {
  return Boolean(env.TELEGRAM_ENABLED && env.TELEGRAM_BOT_TOKEN);
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

const templates = {
  en: {
    payment_received: 'Wallet credited\n\nID: {{receiverCode}}\nProgram: {{orbit}} - Level {{level}}\nAmount: +{{amount}} USDT\nType: {{role}}\nPosition: Line {{line}}, Position {{position}}\nFrom: {{sourceCode}}\nTransaction: {{txUrl}}',
    payment_skipped: 'Payment not delivered\n\nID: {{receiverCode}}\nProgram: Level {{level}}\nExpected: {{expectedAmount}} USDT\nDelivered: {{actualAmount}} USDT\nReason: {{reason}}\nTransaction: {{txUrl}}',
    escrow_locked: 'Auto-upgrade escrow locked\n\nID: {{receiverCode}}\nProgram: {{orbit}} - Level {{fromLevel}} to Level {{toLevel}}\nLocked: {{amount}} USDT\nType: {{role}}\nPosition: Line {{line}}, Position {{position}}\nFrom: {{sourceCode}}\nTransaction: {{txUrl}}',
    escrow_used: 'Escrow used: {{amount}} for level {{toLevel}}.',
    escrow_released: 'Escrow released: {{amount}}.',
    auto_upgrade_completed: 'Auto-upgrade completed from level {{fromLevel}} to {{toLevel}}.',
    recycle_completed: 'Recycle completed on level {{level}}. Credited: {{amount}}.',
    token_reward_eligibility: 'Token reward status updated for level {{level}}.',
    token_reward_minted: 'Token reward minted: {{amount}} {{tokenSymbol}}.',
    system_notice: 'System notice: {{message}}',
    admin_notice: 'Admin notice: {{message}}',
    admin_indexer_warning: 'Indexer warning: {{message}}',
  },
  es: {
    payment_received: 'Pago recibido para el nivel {{level}}. Billetera acreditada: {{amount}}.',
    payment_skipped: 'Pago omitido para el nivel {{level}}. Motivo: {{reasonCode}}.',
    escrow_locked: 'Escrow bloqueado: {{amount}} del nivel {{fromLevel}} al {{toLevel}}.',
    escrow_used: 'Escrow usado: {{amount}} para el nivel {{toLevel}}.',
    escrow_released: 'Escrow liberado: {{amount}}.',
    auto_upgrade_completed: 'Autoactualización completada del nivel {{fromLevel}} al {{toLevel}}.',
    recycle_completed: 'Reciclaje completado en el nivel {{level}}. Acreditado: {{amount}}.',
    token_reward_eligibility: 'Estado de recompensa actualizado para el nivel {{level}}.',
    token_reward_minted: 'Recompensa acuñada: {{amount}} {{tokenSymbol}}.',
    system_notice: 'Aviso del sistema: {{message}}',
    admin_notice: 'Aviso administrativo: {{message}}',
    admin_indexer_warning: 'Advertencia del indexador: {{message}}',
  },
  fa: {
    payment_received: 'پرداخت برای سطح {{level}} دریافت شد. کیف پول بستانکار شد: {{amount}}.',
    payment_skipped: 'پرداخت سطح {{level}} انجام نشد. دلیل: {{reasonCode}}.',
    escrow_locked: 'Escrow قفل شد: {{amount}} از سطح {{fromLevel}} به {{toLevel}}.',
    escrow_used: 'Escrow استفاده شد: {{amount}} برای سطح {{toLevel}}.',
    escrow_released: 'Escrow آزاد شد: {{amount}}.',
    auto_upgrade_completed: 'ارتقای خودکار از سطح {{fromLevel}} به {{toLevel}} کامل شد.',
    recycle_completed: 'بازیافت در سطح {{level}} کامل شد. بستانکار شد: {{amount}}.',
    token_reward_eligibility: 'وضعیت پاداش توکن برای سطح {{level}} به‌روزرسانی شد.',
    token_reward_minted: 'پاداش توکن ساخته شد: {{amount}} {{tokenSymbol}}.',
    system_notice: 'اعلان سیستم: {{message}}',
    admin_notice: 'اعلان مدیریتی: {{message}}',
    admin_indexer_warning: 'هشدار ایندکسر: {{message}}',
  },
  fr: {
    payment_received: 'Paiement reçu pour le niveau {{level}}. Portefeuille crédité : {{amount}}.',
    payment_skipped: 'Paiement ignoré pour le niveau {{level}}. Raison : {{reasonCode}}.',
    escrow_locked: 'Escrow verrouillé : {{amount}} du niveau {{fromLevel}} vers {{toLevel}}.',
    escrow_used: 'Escrow utilisé : {{amount}} pour le niveau {{toLevel}}.',
    escrow_released: 'Escrow libéré : {{amount}}.',
    auto_upgrade_completed: 'Mise à niveau automatique terminée du niveau {{fromLevel}} vers {{toLevel}}.',
    recycle_completed: 'Recyclage terminé au niveau {{level}}. Crédité : {{amount}}.',
    token_reward_eligibility: 'Statut de récompense token mis à jour pour le niveau {{level}}.',
    token_reward_minted: 'Récompense token créée : {{amount}} {{tokenSymbol}}.',
    system_notice: 'Avis système : {{message}}',
    admin_notice: 'Avis admin : {{message}}',
    admin_indexer_warning: 'Avertissement indexeur : {{message}}',
  },
  hi: {
    payment_received: 'स्तर {{level}} के लिए भुगतान प्राप्त हुआ। वॉलेट क्रेडिट: {{amount}}.',
    payment_skipped: 'स्तर {{level}} के लिए भुगतान छोड़ा गया। कारण: {{reasonCode}}.',
    escrow_locked: 'Escrow लॉक हुआ: {{amount}} स्तर {{fromLevel}} से {{toLevel}} तक.',
    escrow_used: 'Escrow उपयोग हुआ: {{amount}} स्तर {{toLevel}} के लिए.',
    escrow_released: 'Escrow जारी हुआ: {{amount}}.',
    auto_upgrade_completed: 'स्वचालित अपग्रेड स्तर {{fromLevel}} से {{toLevel}} तक पूरा हुआ.',
    recycle_completed: 'स्तर {{level}} पर रीसायकल पूरा हुआ। क्रेडिट: {{amount}}.',
    token_reward_eligibility: 'स्तर {{level}} के लिए टोकन पुरस्कार स्थिति अपडेट हुई.',
    token_reward_minted: 'टोकन पुरस्कार मिंट हुआ: {{amount}} {{tokenSymbol}}.',
    system_notice: 'सिस्टम सूचना: {{message}}',
    admin_notice: 'एडमिन सूचना: {{message}}',
    admin_indexer_warning: 'इंडेक्सर चेतावनी: {{message}}',
  },
  id: {
    payment_received: 'Pembayaran diterima untuk level {{level}}. Dompet dikreditkan: {{amount}}.',
    payment_skipped: 'Pembayaran dilewati untuk level {{level}}. Alasan: {{reasonCode}}.',
    escrow_locked: 'Escrow dikunci: {{amount}} dari level {{fromLevel}} ke {{toLevel}}.',
    escrow_used: 'Escrow digunakan: {{amount}} untuk level {{toLevel}}.',
    escrow_released: 'Escrow dilepas: {{amount}}.',
    auto_upgrade_completed: 'Peningkatan otomatis selesai dari level {{fromLevel}} ke {{toLevel}}.',
    recycle_completed: 'Daur ulang selesai di level {{level}}. Dikreditkan: {{amount}}.',
    token_reward_eligibility: 'Status hadiah token diperbarui untuk level {{level}}.',
    token_reward_minted: 'Hadiah token dicetak: {{amount}} {{tokenSymbol}}.',
    system_notice: 'Pemberitahuan sistem: {{message}}',
    admin_notice: 'Pemberitahuan admin: {{message}}',
    admin_indexer_warning: 'Peringatan indexer: {{message}}',
  },
  it: {
    payment_received: 'Pagamento ricevuto per il livello {{level}}. Wallet accreditato: {{amount}}.',
    payment_skipped: 'Pagamento saltato per il livello {{level}}. Motivo: {{reasonCode}}.',
    escrow_locked: 'Escrow bloccato: {{amount}} dal livello {{fromLevel}} al {{toLevel}}.',
    escrow_used: 'Escrow usato: {{amount}} per il livello {{toLevel}}.',
    escrow_released: 'Escrow rilasciato: {{amount}}.',
    auto_upgrade_completed: 'Auto-aggiornamento completato dal livello {{fromLevel}} al {{toLevel}}.',
    recycle_completed: 'Riciclo completato al livello {{level}}. Accreditato: {{amount}}.',
    token_reward_eligibility: 'Stato premio token aggiornato per il livello {{level}}.',
    token_reward_minted: 'Premio token creato: {{amount}} {{tokenSymbol}}.',
    system_notice: 'Avviso di sistema: {{message}}',
    admin_notice: 'Avviso admin: {{message}}',
    admin_indexer_warning: 'Avviso indexer: {{message}}',
  },
  ko: {
    payment_received: '레벨 {{level}} 결제가 수신되었습니다. 지갑 적립: {{amount}}.',
    payment_skipped: '레벨 {{level}} 결제가 건너뛰어졌습니다. 사유: {{reasonCode}}.',
    escrow_locked: 'Escrow 잠김: {{amount}}, 레벨 {{fromLevel}}에서 {{toLevel}}.',
    escrow_used: 'Escrow 사용: {{amount}}, 레벨 {{toLevel}}.',
    escrow_released: 'Escrow 해제: {{amount}}.',
    auto_upgrade_completed: '자동 업그레이드 완료: 레벨 {{fromLevel}}에서 {{toLevel}}.',
    recycle_completed: '레벨 {{level}} 재순환 완료. 적립: {{amount}}.',
    token_reward_eligibility: '레벨 {{level}} 토큰 보상 상태가 업데이트되었습니다.',
    token_reward_minted: '토큰 보상 발행: {{amount}} {{tokenSymbol}}.',
    system_notice: '시스템 공지: {{message}}',
    admin_notice: '관리자 공지: {{message}}',
    admin_indexer_warning: '인덱서 경고: {{message}}',
  },
  ru: {
    payment_received: 'Платеж получен для уровня {{level}}. Кошелек зачислен: {{amount}}.',
    payment_skipped: 'Платеж пропущен для уровня {{level}}. Причина: {{reasonCode}}.',
    escrow_locked: 'Escrow заблокирован: {{amount}} с уровня {{fromLevel}} на {{toLevel}}.',
    escrow_used: 'Escrow использован: {{amount}} для уровня {{toLevel}}.',
    escrow_released: 'Escrow освобожден: {{amount}}.',
    auto_upgrade_completed: 'Автообновление завершено с уровня {{fromLevel}} на {{toLevel}}.',
    recycle_completed: 'Рецикл завершен на уровне {{level}}. Зачислено: {{amount}}.',
    token_reward_eligibility: 'Статус токен-награды обновлен для уровня {{level}}.',
    token_reward_minted: 'Токен-награда создана: {{amount}} {{tokenSymbol}}.',
    system_notice: 'Системное уведомление: {{message}}',
    admin_notice: 'Админ-уведомление: {{message}}',
    admin_indexer_warning: 'Предупреждение индексера: {{message}}',
  },
  vi: {
    payment_received: 'Đã nhận thanh toán cho cấp {{level}}. Ví được ghi có: {{amount}}.',
    payment_skipped: 'Thanh toán bị bỏ qua cho cấp {{level}}. Lý do: {{reasonCode}}.',
    escrow_locked: 'Escrow đã khóa: {{amount}} từ cấp {{fromLevel}} đến {{toLevel}}.',
    escrow_used: 'Escrow đã dùng: {{amount}} cho cấp {{toLevel}}.',
    escrow_released: 'Escrow đã giải phóng: {{amount}}.',
    auto_upgrade_completed: 'Tự nâng cấp hoàn tất từ cấp {{fromLevel}} đến {{toLevel}}.',
    recycle_completed: 'Tái chế hoàn tất ở cấp {{level}}. Ghi có: {{amount}}.',
    token_reward_eligibility: 'Trạng thái thưởng token đã cập nhật cho cấp {{level}}.',
    token_reward_minted: 'Thưởng token đã đúc: {{amount}} {{tokenSymbol}}.',
    system_notice: 'Thông báo hệ thống: {{message}}',
    admin_notice: 'Thông báo admin: {{message}}',
    admin_indexer_warning: 'Cảnh báo indexer: {{message}}',
  },
  zh: {
    payment_received: '等级 {{level}} 已收到付款。钱包已入账：{{amount}}。',
    payment_skipped: '等级 {{level}} 的付款已跳过。原因：{{reasonCode}}。',
    escrow_locked: 'Escrow 已锁定：{{amount}}，从等级 {{fromLevel}} 到 {{toLevel}}。',
    escrow_used: 'Escrow 已使用：{{amount}}，用于等级 {{toLevel}}。',
    escrow_released: 'Escrow 已释放：{{amount}}。',
    auto_upgrade_completed: '自动升级已完成：等级 {{fromLevel}} 到 {{toLevel}}。',
    recycle_completed: '等级 {{level}} 循环已完成。入账：{{amount}}。',
    token_reward_eligibility: '等级 {{level}} 的代币奖励状态已更新。',
    token_reward_minted: '代币奖励已铸造：{{amount}} {{tokenSymbol}}。',
    system_notice: '系统通知：{{message}}',
    admin_notice: '管理员通知：{{message}}',
    admin_indexer_warning: '索引器警告：{{message}}',
  },
};

function renderTemplate(type, params = {}, language = 'en') {
  const catalog = templates[language] || templates.en;
  const template = catalog[type] || templates.en[type] || 'Notification update: {{message}}';
  const normalizedParams = normalizeTemplateParams(type, params);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = normalizedParams[key];
    return value === undefined || value === null || value === '' ? '-' : String(value);
  });
}

function formatRawUnits(value, decimals = 6, fixedDecimals = null) {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+$/.test(raw)) return raw;
  try {
    const negative = raw.startsWith('-');
    const digits = raw.replace(/^-/, '').padStart(decimals + 1, '0');
    const whole = digits.slice(0, -decimals) || '0';
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    const valueText = fraction ? `${whole}.${fraction}` : whole;
    const signed = negative ? `-${valueText}` : valueText;
    return fixedDecimals === null ? signed : Number(signed).toFixed(fixedDecimals);
  } catch {
    return raw;
  }
}

function normalizeTemplateParams(type, params = {}) {
  const next = { ...params };
  const usdtTypes = new Set([
    'payment_received',
    'payment_skipped',
    'escrow_locked',
    'escrow_used',
    'escrow_released',
    'auto_upgrade_completed',
    'recycle_completed',
  ]);

  if (usdtTypes.has(type)) {
    for (const key of ['amount', 'generatedAmount', 'escrowLocked', 'expectedAmount', 'actualAmount', 'usedAmount']) {
      if (next[key] !== undefined) next[key] = formatRawUnits(next[key], 6, 2);
    }
  }

  if (type === 'token_reward_minted' || type === 'token_reward_eligibility') {
    if (next.amount !== undefined) next.amount = formatRawUnits(next.amount, 6, null);
  }

  return next;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function nextRetryDate(attemptCount) {
  const delay = env.NOTIFICATION_DELIVERY_RETRY_BASE_DELAY_MS * Math.max(1, attemptCount);
  return new Date(Date.now() + delay);
}

function getTelegramBotUsername() {
  return String(env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim();
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

function buildBotDeepLink(code) {
  const username = getTelegramBotUsername();
  return username ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : '';
}

function parseTelegramRetryAfter(errorText) {
  const match = String(errorText || '').match(/"retry_after"\s*:\s*(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : 0;
}

function extractTelegramCode(update = {}) {
  const text = String(update?.message?.text || '').trim();
  if (!text) return '';
  const startMatch = text.match(/^\/start(?:@\w+)?\s+(\d{6})$/i);
  if (startMatch) return startMatch[1];
  const codeMatch = text.match(/\b(\d{6})\b/);
  return codeMatch ? codeMatch[1] : '';
}

export async function startTelegramLink({ walletAddress, language = 'en', signature = '', timestamp = 0 }) {
  const normalized = requireWalletProof({
    walletAddress,
    action: 'telegram_link_start',
    signature,
    timestamp,
  });

  const code = String(crypto.randomInt(100000, 999999));
  await TelegramSubscription.updateOne(
    { walletAddress: normalized },
    {
      $set: {
        walletAddress: normalized,
        language,
        status: 'pending',
        verificationCodeHash: hashCode(code),
        verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    },
    { upsert: true }
  );

  return {
    ok: true,
    configured: isTelegramReady(),
    botUsername: getTelegramBotUsername(),
    botDeepLink: buildBotDeepLink(code),
    verificationCode: code,
    expiresInSeconds: 600,
  };
}

export async function handleTelegramWebhook(update = {}) {
  const code = extractTelegramCode(update);
  const chatId = update?.message?.chat?.id;
  const from = update?.message?.from || {};

  if (!code || !chatId) {
    return { ok: true, ignored: true };
  }

  const subscription = await TelegramSubscription.findOne({
    verificationCodeHash: hashCode(code),
    status: 'pending',
    verificationExpiresAt: { $gt: new Date() },
  });

  if (!subscription) {
    return { ok: true, linked: false, reason: 'code_not_found_or_expired' };
  }

  subscription.chatId = String(chatId);
  subscription.telegramUserId = String(from.id || '').trim();
  subscription.username = String(from.username || '').trim();
  subscription.status = 'active';
  subscription.verificationCodeHash = '';
  subscription.verificationExpiresAt = null;
  await subscription.save();

  if (isTelegramReady()) {
    fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'Telegram alerts are now active for your F-Freedom wallet.',
        disable_web_page_preview: true,
      }),
    }).catch(() => {});
  }

  return { ok: true, linked: true };
}

export async function verifyTelegramLink({ walletAddress, code, chatId, telegramUserId = '', username = '', language = 'en', signature = '', timestamp = 0 }) {
  const normalized = requireWalletProof({
    walletAddress,
    action: 'telegram_link_verify',
    signature,
    timestamp,
  });
  const subscription = await TelegramSubscription.findOne({ walletAddress: normalized, status: 'pending' });

  if (!subscription || !subscription.verificationExpiresAt || subscription.verificationExpiresAt < new Date()) {
    const error = new Error('Verification code expired or not found');
    error.status = 400;
    throw error;
  }

  if (subscription.verificationCodeHash !== hashCode(code)) {
    const error = new Error('Invalid verification code');
    error.status = 400;
    throw error;
  }

  subscription.chatId = String(chatId || '').trim();
  subscription.telegramUserId = String(telegramUserId || '').trim();
  subscription.username = String(username || '').trim();
  subscription.language = language || subscription.language || 'en';
  subscription.status = 'active';
  subscription.verificationCodeHash = '';
  subscription.verificationExpiresAt = null;
  await subscription.save();

  return { ok: true, configured: isTelegramReady(), status: subscription.status };
}

export async function getTelegramStatus(walletAddress) {
  const normalized = normalizeWalletAddress(walletAddress);
  const subscription = normalized
    ? await TelegramSubscription.findOne({ walletAddress: normalized }).lean()
    : null;

  return {
    ok: true,
    configured: isTelegramReady(),
    enabled: Boolean(env.TELEGRAM_ENABLED),
    userNotificationsEnabled: Boolean(env.TELEGRAM_USER_NOTIFICATIONS_ENABLED),
    status: subscription?.status || 'unlinked',
    preferences: subscription?.preferences || null,
    language: subscription?.language || 'en',
  };
}

export async function updateTelegramPreferences(walletAddress, preferences = {}, proof = {}) {
  const normalized = requireWalletProof({
    walletAddress,
    action: 'telegram_preferences_update',
    signature: proof.signature,
    timestamp: proof.timestamp,
  });

  const allowed = [
    'paymentReceived',
    'paymentSkipped',
    'escrow',
    'autoUpgrade',
    'recycle',
    'tokenRewards',
    'systemNotices',
    'communityNotices',
  ];
  const update = {};
  for (const key of allowed) {
    if (typeof preferences[key] === 'boolean') update[`preferences.${key}`] = preferences[key];
  }

  const subscription = await TelegramSubscription.findOneAndUpdate(
    { walletAddress: normalized },
    { $set: update },
    { new: true }
  ).lean();

  return { ok: true, preferences: subscription?.preferences || null };
}

export async function unsubscribeTelegram(walletAddress, proof = {}) {
  const normalized = requireWalletProof({
    walletAddress,
    action: 'telegram_unsubscribe',
    signature: proof.signature,
    timestamp: proof.timestamp,
  });
  await TelegramSubscription.updateOne(
    { walletAddress: normalized },
    { $set: { status: 'unsubscribed' } }
  );
  return { ok: true, status: 'unsubscribed' };
}

export async function dispatchTelegramNotification(notification) {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_USER_NOTIFICATIONS_ENABLED) return null;

  const subscription = await TelegramSubscription.findOne({
    walletAddress: notification.walletAddress,
    status: 'active',
  }).lean();

  if (!subscription || !isTelegramReady()) {
    return NotificationDeliveryAttempt.create({
      notificationId: notification._id,
      walletAddress: notification.walletAddress,
      channel: 'telegram',
      status: 'skipped',
      attemptCount: 0,
      lastError: !subscription ? 'No active Telegram subscription' : 'Telegram is not configured',
    });
  }

  const preferenceKey = preferenceKeyForNotification(notification.notificationType);
  if (preferenceKey && subscription.preferences?.[preferenceKey] === false) {
    return NotificationDeliveryAttempt.create({
      notificationId: notification._id,
      walletAddress: notification.walletAddress,
      channel: 'telegram',
      status: 'skipped',
      attemptCount: 0,
      lastError: `Telegram preference disabled: ${preferenceKey}`,
    });
  }

  return NotificationDeliveryAttempt.create({
    notificationId: notification._id,
    walletAddress: notification.walletAddress,
    channel: 'telegram',
    status: 'queued',
    attemptCount: 0,
    nextRetryAt: nextRetryDate(1),
  });
}

export async function sendTelegramAttempt(attempt) {
  if (!attempt || attempt.status === 'sent') return attempt;

  const notification = attempt.notificationId && typeof attempt.notificationId === 'object'
    ? attempt.notificationId
    : null;

  if (!isTelegramReady()) {
    attempt.status = 'skipped';
    attempt.lastError = 'Telegram is not configured';
    await attempt.save();
    return attempt;
  }

  const subscription = notification?.walletAddress
    ? await TelegramSubscription.findOne({
        walletAddress: notification.walletAddress,
        status: 'active',
      }).lean()
    : null;

  const chatId = subscription?.chatId || env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    attempt.status = 'skipped';
    attempt.lastError = 'No Telegram chat configured';
    await attempt.save();
    return attempt;
  }

  const text = notification
    ? renderTemplate(notification.notificationType, notification.i18nParams || {}, subscription?.language || 'en')
    : (attempt.message || attempt.lastError || 'Admin alert.');

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Telegram send failed: ${response.status} ${body.slice(0, 160)}`);
    }

    attempt.status = 'sent';
    attempt.sentAt = new Date();
    attempt.lastError = '';
    await attempt.save();

    if (notification?.walletAddress) {
      await TelegramSubscription.updateOne(
        { walletAddress: notification.walletAddress },
        { $set: { lastDeliveredAt: new Date() } }
      );
    }

    return attempt;
  } catch (error) {
    const errorText = error?.message || String(error);
    const retryAfterSeconds = parseTelegramRetryAfter(errorText);
    attempt.attemptCount += 1;
    attempt.lastError = errorText;
    if (attempt.attemptCount >= env.NOTIFICATION_DELIVERY_RETRY_LIMIT) {
      attempt.status = 'failed';
      attempt.nextRetryAt = null;
    } else {
      attempt.status = 'queued';
      attempt.nextRetryAt = retryAfterSeconds
        ? new Date(Date.now() + (retryAfterSeconds + 2) * 1000)
        : nextRetryDate(attempt.attemptCount + 1);
    }
    await attempt.save();
    return attempt;
  }
}

export async function processTelegramDeliveryQueue({ limit = 25 } = {}) {
  if (!env.TELEGRAM_ENABLED) return { ok: true, skipped: true, processed: 0 };

  const attempts = await NotificationDeliveryAttempt.find({
    channel: 'telegram',
    status: 'queued',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  })
    .populate('notificationId')
    .sort({ createdAt: 1 })
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const attempt of attempts) {
    const result = await sendTelegramAttempt(attempt);
    if (result.status === 'sent') sent += 1;
    if (result.status === 'failed') failed += 1;
    if (result.status === 'skipped') skipped += 1;
  }

  return { ok: true, processed: attempts.length, sent, failed, skipped };
}

export async function reportAdminTelegramAlert(type, payload = {}) {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_ADMIN_REPORTS_ENABLED || !env.TELEGRAM_ADMIN_CHAT_ID) {
    return null;
  }

  const safePayload = Object.fromEntries(
    Object.entries(payload || {}).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 240) : value])
  );
  const message = renderTemplate(type, {
    message: JSON.stringify({ type, ...safePayload }).slice(0, 900),
  }, 'en');

  return NotificationDeliveryAttempt.create({
    channel: 'telegram',
    status: isTelegramReady() ? 'queued' : 'skipped',
    attemptCount: 0,
    message,
    lastError: isTelegramReady() ? '' : 'Telegram is not configured',
    nextRetryAt: isTelegramReady() ? nextRetryDate(1) : null,
    walletAddress: '',
    notificationId: null,
  });
}
