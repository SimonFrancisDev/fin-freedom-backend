import { fetchOrbitEventsByAddress } from '../services/read/orbitEventQueryService.js';

export async function getOrbitEventsByAddress(req, res, next) {
  try {
    const { address } = req.params;
    const data = await fetchOrbitEventsByAddress(address, req.query);

    res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    next(error);
  }
}