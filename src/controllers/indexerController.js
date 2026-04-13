import { fetchIndexerStatus } from '../services/read/syncQueryService.js';

export async function getIndexerStatus(req, res, next) {
  try {
    const data = await fetchIndexerStatus();

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}