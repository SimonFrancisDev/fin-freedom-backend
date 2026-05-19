import env from '../../config/env.js';
import { processTelegramDeliveryQueue } from './telegramService.js';

let workerTimer = null;
let running = false;

export function startNotificationDeliveryWorker() {
  if (workerTimer || !env.TELEGRAM_ENABLED) return;

  workerTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processTelegramDeliveryQueue();
    } catch (error) {
      console.error('[NOTIFICATION_DELIVERY_WORKER_FAILED]', error?.message || String(error));
    } finally {
      running = false;
    }
  }, Math.max(5000, env.NOTIFICATION_DELIVERY_RETRY_BASE_DELAY_MS || 30000));
}

export function stopNotificationDeliveryWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
