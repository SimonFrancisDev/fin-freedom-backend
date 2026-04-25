import {
  fetchCommunitySummary,
  fetchCommunityAnnouncements,
  fetchCommunityEvents,
  fetchCommunitySocialLinks,
  fetchCommunityResources,
} from '../services/read/communityQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 15) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

export async function getCommunitySummary(req, res, next) {
  try {
    const data = await fetchCommunitySummary();

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityAnnouncements(req, res, next) {
  try {
    const data = await fetchCommunityAnnouncements();

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityEvents(req, res, next) {
  try {
    const data = await fetchCommunityEvents();

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunitySocialLinks(req, res, next) {
  try {
    const data = await fetchCommunitySocialLinks();

    setApiCacheHeaders(res, 15);

    res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityResources(req, res, next) {
  try {
    const data = await fetchCommunityResources();

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
//   fetchCommunitySummary,
//   fetchCommunityAnnouncements,
//   fetchCommunityEvents,
//   fetchCommunitySocialLinks,
//   fetchCommunityResources,
// } from '../services/read/communityQueryService.js';

// export async function getCommunitySummary(req, res, next) {
//   try {
//     const data = await fetchCommunitySummary();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityAnnouncements(req, res, next) {
//   try {
//     const data = await fetchCommunityAnnouncements();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityEvents(req, res, next) {
//   try {
//     const data = await fetchCommunityEvents();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunitySocialLinks(req, res, next) {
//   try {
//     const data = await fetchCommunitySocialLinks();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityResources(req, res, next) {
//   try {
//     const data = await fetchCommunityResources();

//     res.status(200).json({
//       ok: true,
//       data,
//     });
//   } catch (error) {
//     next(error);
//   }
// }