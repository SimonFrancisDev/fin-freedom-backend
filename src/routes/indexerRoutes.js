import express from 'express';
import { getIndexerStatus } from '../controllers/indexerController.js';

const router = express.Router();

router.get('/status', getIndexerStatus);

export default router;