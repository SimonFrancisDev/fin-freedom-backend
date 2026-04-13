import {
  fetchCommunityLeaderboard,
  fetchCommunityGrowth,
  fetchCommunityGlobalStats,
  fetchTopReferrers,
  fetchMostActive,
} from '../services/read/communityAnalyticsService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 15) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

export async function getCommunityLeaderboard(req, res, next) {
  try {
    const limit = req.query.limit;
    const data = await fetchCommunityLeaderboard(limit);

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityGrowth(req, res, next) {
  try {
    const days = req.query.days;
    const data = await fetchCommunityGrowth(days);

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityGlobalStats(req, res, next) {
  try {
    const data = await fetchCommunityGlobalStats();

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTopReferrers(req, res, next) {
  try {
    const limit = req.query.limit;
    const data = await fetchTopReferrers(limit);

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMostActive(req, res, next) {
  try {
    const limit = req.query.limit;
    const days = req.query.days;
    const data = await fetchMostActive(limit, days);

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}










// import {
//   fetchCommunityLeaderboard,
//   fetchCommunityGrowth,
//   fetchCommunityGlobalStats,
//    fetchTopReferrers,
//   fetchMostActive,
// } from '../services/read/communityAnalyticsService.js';

// export async function getCommunityLeaderboard(req, res, next) {
//   try {
//     const limit = req.query.limit;
//     const data = await fetchCommunityLeaderboard(limit);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityGrowth(req, res, next) {
//   try {
//     const days = req.query.days;
//     const data = await fetchCommunityGrowth(days);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityGlobalStats(req, res, next) {
//   try {
//     const data = await fetchCommunityGlobalStats();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }


// export async function getTopReferrers(req, res, next) {
//   try {
//     const limit = req.query.limit;
//     const data = await fetchTopReferrers(limit);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getMostActive(req, res, next) {
//   try {
//     const limit = req.query.limit;
//     const days = req.query.days;
//     const data = await fetchMostActive(limit, days);

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }