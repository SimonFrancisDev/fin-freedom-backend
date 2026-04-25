import {
  fetchCommunityMemberSummary,
  fetchCommunityMemberReferralStats,
  fetchCommunityMemberDownlineStats,
  fetchCommunityMemberOrbitNetwork,
} from '../services/read/communityMemberQueryService.js';

function setApiCacheHeaders(res, maxAgeSeconds = 15) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

export async function getCommunityMemberSummary(req, res, next) {
  try {
    const data = await fetchCommunityMemberSummary(req.params.address);
    setApiCacheHeaders(res, 15);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityMemberReferralStats(req, res, next) {
  try {
    const data = await fetchCommunityMemberReferralStats(req.params.address);
    setApiCacheHeaders(res, 15);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityMemberDownlineStats(req, res, next) {
  try {
    const data = await fetchCommunityMemberDownlineStats(req.params.address);
    setApiCacheHeaders(res, 15);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}


export  async function getCommunityMemberOrbitNetwork(req, res, next) {
  try {
    const data = await fetchCommunityMemberOrbitNetwork(req.params.address);
    setApiCacheHeaders(res, 15);
    res.status(200).json({ ok: true, data })
  } catch (error) {
    next(error)
  }
}












// import {
//   fetchCommunityMemberSummary,
//   fetchCommunityMemberReferralStats,
//   fetchCommunityMemberDownlineStats,
// } from '../services/read/communityMemberQueryService.js';

// export async function getCommunityMemberSummary(req, res, next) {
//   try {
//     const data = await fetchCommunityMemberSummary(req.params.address);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityMemberReferralStats(req, res, next) {
//   try {
//     const data = await fetchCommunityMemberReferralStats(req.params.address);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getCommunityMemberDownlineStats(req, res, next) {
//   try {
//     const data = await fetchCommunityMemberDownlineStats(req.params.address);
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }