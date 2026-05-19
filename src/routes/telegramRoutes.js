import express from 'express';
import {
  getTelegramStatusController,
  startTelegramLinkController,
  telegramWebhookController,
  unsubscribeTelegramController,
  updateTelegramPreferencesController,
  verifyTelegramLinkController,
} from '../controllers/telegramController.js';

const router = express.Router();

router.post('/link/start', startTelegramLinkController);
router.post('/link/verify', verifyTelegramLinkController);
router.get('/status', getTelegramStatusController);
router.patch('/preferences', updateTelegramPreferencesController);
router.post('/unsubscribe', unsubscribeTelegramController);
router.post('/webhook', telegramWebhookController);

export default router;
