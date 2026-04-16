import express from 'express';
import {
  getOrbitLevels,
  getOrbitLevelSnapshot,
  getOrbitPositionDetails,
  getOrbitCycleSnapshot,
} from '../controllers/orbitController.js';

const router = express.Router();

router.get('/:address/levels', getOrbitLevels);
router.get('/:address/level/:level', getOrbitLevelSnapshot);
router.get('/:address/level/:level/position/:position', getOrbitPositionDetails);
router.get('/:address/level/:level/cycle/:cycleNumber', getOrbitCycleSnapshot);

export default router;
