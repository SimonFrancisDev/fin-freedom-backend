import express from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  postAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
  postEvent,
  patchEvent,
  removeEvent,
  postSocialLink,
  patchSocialLink,
  removeSocialLink,
  postResource,
  patchResource,
  removeResource,
} from '../controllers/adminCommunityController.js';
import {
  getAdminAnnouncements,
  getAdminEvents,
  getAdminSocialLinks,
  getAdminResources,
} from '../controllers/adminCommunityReadController.js';

const router = express.Router();

router.use(requireAdmin);

router.get('/announcements', getAdminAnnouncements);
router.get('/events', getAdminEvents);
router.get('/social-links', getAdminSocialLinks);
router.get('/resources', getAdminResources);

router.post('/announcements', postAnnouncement);
router.patch('/announcements/:id', patchAnnouncement);
router.delete('/announcements/:id', removeAnnouncement);

router.post('/events', postEvent);
router.patch('/events/:id', patchEvent);
router.delete('/events/:id', removeEvent);

router.post('/social-links', postSocialLink);
router.patch('/social-links/:id', patchSocialLink);
router.delete('/social-links/:id', removeSocialLink);

router.post('/resources', postResource);
router.patch('/resources/:id', patchResource);
router.delete('/resources/:id', removeResource);

export default router;