import express from 'express';
import { getReceiptsByAddress, getReceiptsByActivationId } from '../controllers/receiptController.js';

const router = express.Router();

router.get('/address/:address', getReceiptsByAddress);
router.get('/activation/:activationId', getReceiptsByActivationId);

export default router;







// import express from 'express';
// import { getReceiptsByAddress, getReceiptsByActivationId } from '../controllers/receiptController.js';

// const router = express.Router();

// router.get('/address/:address', getReceiptsByAddress);
// router.get('/activation/:activationId', getReceiptsByActivationId);

// export default router;