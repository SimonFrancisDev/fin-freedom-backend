import express from 'express';
import {
  getOrbitLevels,
  getOrbitLevelSnapshot,
  getOrbitPositionDetails,
  getOrbitCycleSnapshot,
  getUserSummary,
} from '../controllers/orbitController.js';

const router = express.Router();

router.get('/:address/levels', getOrbitLevels);
router.get('/:address/level/:level', getOrbitLevelSnapshot);
router.get('/:address/level/:level/position/:position', getOrbitPositionDetails);
router.get('/:address/level/:level/cycle/:cycleNumber', getOrbitCycleSnapshot);
router.get('/:address/summary', getUserSummary);
export default router;
