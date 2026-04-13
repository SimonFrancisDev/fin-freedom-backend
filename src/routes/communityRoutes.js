import express from 'express';
import {
  getCommunitySummary,
  getCommunityAnnouncements,
  getCommunityEvents,
  getCommunitySocialLinks,
  getCommunityResources,
} from '../controllers/communityController.js';

import {
  getCommunityMemberSummary,
  getCommunityMemberReferralStats,
  getCommunityMemberDownlineStats,
} from '../controllers/communityMemberController.js';

import {
  getCommunityLeaderboard,
  getCommunityGrowth,
  getCommunityGlobalStats,
  getTopReferrers,    
  getMostActive,
} from '../controllers/communityAnalyticsController.js';

const router = express.Router();

router.get('/summary', getCommunitySummary);
router.get('/announcements', getCommunityAnnouncements);
router.get('/events', getCommunityEvents);
router.get('/social-links', getCommunitySocialLinks);
router.get('/resources', getCommunityResources);

router.get('/member/:address/summary', getCommunityMemberSummary);
router.get('/member/:address/referrals', getCommunityMemberReferralStats);
router.get('/member/:address/downline', getCommunityMemberDownlineStats);

router.get('/leaderboard', getCommunityLeaderboard);
router.get('/growth', getCommunityGrowth);
router.get('/stats', getCommunityGlobalStats);


router.get('/top-referrers', getTopReferrers);
router.get('/most-active', getMostActive);

export default router;