import {
  fetchOrbitLevels,
  fetchOrbitLevelSnapshot,
  fetchOrbitPositionDetails,
  fetchOrbitCycleSnapshot,
  fetchUserGlobalSummary,
} from '../services/read/orbitQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 5) {
  res.set(
    'Cache-Control',
    `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`
  );
}

function setResponseMetaHeaders(res, startedAt) {
  const durationMs = Date.now() - startedAt;
  res.set('X-Response-Time-Ms', String(durationMs));
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
  const startedAt = Date.now();

  try {
    const { address } = req.params;
    const data = await fetchOrbitLevels(address);

    setApiCacheHeaders(res, 5);
    setResponseMetaHeaders(res, startedAt);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitLevelSnapshot(req, res, next) {
  const startedAt = Date.now();

  try {
    const { address, level } = req.params;

    const data = await fetchOrbitLevelSnapshot(
      address,
      toIntegerParam(level, 'level')
    );

    setApiCacheHeaders(res, 5);
    setResponseMetaHeaders(res, startedAt);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitPositionDetails(req, res, next) {
  const startedAt = Date.now();

  try {
    const { address, level, position } = req.params;

    const data = await fetchOrbitPositionDetails(
      address,
      toIntegerParam(level, 'level'),
      toIntegerParam(position, 'position')
    );

    setApiCacheHeaders(res, 5);
    setResponseMetaHeaders(res, startedAt);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 5,
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrbitCycleSnapshot(req, res, next) {
  const startedAt = Date.now();

  try {
    const { address, level, cycleNumber } = req.params;

    const data = await fetchOrbitCycleSnapshot(
      address,
      toIntegerParam(level, 'level'),
      toIntegerParam(cycleNumber, 'cycleNumber')
    );

    setApiCacheHeaders(res, 10);
    setResponseMetaHeaders(res, startedAt);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        cacheSeconds: 10,
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}




export async function getUserSummary(req, res, next) {
  const startedAt = Date.now();
  try {
    const { address } = req.params;
    
    // We will build this service function in the next step
    const data = await fetchUserGlobalSummary(address);

    setApiCacheHeaders(res, 15); // Short cache for dashboard data
    setResponseMetaHeaders(res, startedAt);

    res.status(200).json({
      ok: true,
      data,
      meta: {
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}
