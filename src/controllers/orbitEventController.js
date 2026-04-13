import { fetchOrbitEventsByAddress } from '../services/read/orbitEventQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 10) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

export async function getOrbitEventsByAddress(req, res, next) {
  try {
    const { address } = req.params;
    const data = await fetchOrbitEventsByAddress(address, req.query);

    setApiCacheHeaders(res, 10);

    res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    next(error);
  }
}









// import { fetchOrbitEventsByAddress } from '../services/read/orbitEventQueryService.js';

// export async function getOrbitEventsByAddress(req, res, next) {
//   try {
//     const { address } = req.params;
//     const data = await fetchOrbitEventsByAddress(address, req.query);

//     res.status(200).json({
//       ok: true,
//       ...data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }