import express from 'express';
import { getOrbitEventsByAddress } from '../controllers/orbitEventController.js';

const router = express.Router();

router.get('/address/:address', getOrbitEventsByAddress);

export default router;
