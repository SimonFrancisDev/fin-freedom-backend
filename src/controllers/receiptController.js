import {
  fetchReceiptsByAddress,
  fetchReceiptsByActivationId,
} from '../services/read/receiptQueryService.js';

export async function getReceiptsByAddress(req, res, next) {
  try {
    const { address } = req.params;
    const data = await fetchReceiptsByAddress(address, req.query);

    res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getReceiptsByActivationId(req, res, next) {
  try {
    const { activationId } = req.params;
    const data = await fetchReceiptsByActivationId(activationId, req.query);

    res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    next(error);
  }
}