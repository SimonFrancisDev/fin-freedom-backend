import {
  fetchCommunityMemberSummary,
  fetchCommunityMemberReferralStats,
  fetchCommunityMemberDownlineStats,
} from '../services/read/communityMemberQueryService.js';

export async function getCommunityMemberSummary(req, res, next) {
  try {
    const data = await fetchCommunityMemberSummary(req.params.address);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityMemberReferralStats(req, res, next) {
  try {
    const data = await fetchCommunityMemberReferralStats(req.params.address);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getCommunityMemberDownlineStats(req, res, next) {
  try {
    const data = await fetchCommunityMemberDownlineStats(req.params.address);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}