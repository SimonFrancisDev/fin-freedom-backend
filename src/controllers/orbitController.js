import {
  fetchOrbitLevels,
  fetchOrbitLevelSnapshot,
  fetchOrbitPositionDetails,
  fetchOrbitCycleSnapshot,
} from '../services/read/orbitQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 5) {
  res.set(
    'Cache-Control',
    `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`
  );
}

function toIntegerParam(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    const error = new Error(`Invalid ${fieldName}`);
    error.status = 400;
    throw error;
  }

  return parsed;
}

export async function getOrbitLevels(req, res, next) {
  try {
    const { address } = req.params;
    const data = await fetchOrbitLevels(address);

    setApiCacheHeaders(res, 5);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitLevelSnapshot(req, res, next) {
  try {
    const { address, level } = req.params;

    const data = await fetchOrbitLevelSnapshot(
      address,
      toIntegerParam(level, 'level')
    );

    setApiCacheHeaders(res, 5);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitPositionDetails(req, res, next) {
  try {
    const { address, level, position } = req.params;

    const data = await fetchOrbitPositionDetails(
      address,
      toIntegerParam(level, 'level'),
      toIntegerParam(position, 'position')
    );

    setApiCacheHeaders(res, 5);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitCycleSnapshot(req, res, next) {
  try {
    const { address, level, cycleNumber } = req.params;

    const data = await fetchOrbitCycleSnapshot(
      address,
      toIntegerParam(level, 'level'),
      toIntegerParam(cycleNumber, 'cycleNumber')
    );

    setApiCacheHeaders(res, 10);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 10,
      },
    });
  } catch (error) {
    next(error);
  }
}









//==================================
// FIRST VERSION
// ================================
// import {
//   fetchOrbitLevels,
//   fetchOrbitLevelSnapshot,
//   fetchOrbitPositionDetails,
//   fetchOrbitCycleSnapshot,
// } from '../services/read/orbitQueryService.js';

// function setApiCacheHeaders(res, maxAgeSeconds = 10) {
//   res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
// }

// export async function getOrbitLevels(req, res, next) {
//   try {
//     const { address } = req.params;
//     const data = await fetchOrbitLevels(address);

//     setApiCacheHeaders(res, 10);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getOrbitLevelSnapshot(req, res, next) {
//   try {
//     const { address, level } = req.params;
//     const data = await fetchOrbitLevelSnapshot(address, Number(level));

//     setApiCacheHeaders(res, 10);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getOrbitPositionDetails(req, res, next) {
//   try {
//     const { address, level, position } = req.params;
//     const data = await fetchOrbitPositionDetails(
//       address,
//       Number(level),
//       Number(position)
//     );

//     setApiCacheHeaders(res, 10);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getOrbitCycleSnapshot(req, res, next) {
//   try {
//     const { address, level, cycleNumber } = req.params;
//     const data = await fetchOrbitCycleSnapshot(
//       address,
//       Number(level),
//       Number(cycleNumber)
//     );

//     setApiCacheHeaders(res, 10);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }
