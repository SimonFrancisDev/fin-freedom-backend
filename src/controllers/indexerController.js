import { fetchIndexerStatus } from '../services/read/syncQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 5) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

export async function getIndexerStatus(req, res, next) {
  try {
    const data = await fetchIndexerStatus();

    setApiCacheHeaders(res, 5);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}






// import { fetchIndexerStatus } from '../services/read/syncQueryService.js';

// export async function getIndexerStatus(req, res, next) {
//   try {
//     const data = await fetchIndexerStatus();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }