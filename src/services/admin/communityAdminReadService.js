import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
import CommunityEvent from '../../models/CommunityEvent.js';
import CommunitySocialLink from '../../models/CommunitySocialLink.js';
import CommunityResource from '../../models/CommunityResource.js';

export async function listAdminAnnouncements() {
  return await CommunityAnnouncement.find({})
    .sort({ priority: -1, createdAt: -1 })
    .lean();
}

export async function listAdminEvents() {
  return await CommunityEvent.find({})
    .sort({ priority: -1, startAt: 1, createdAt: -1 })
    .lean();
}

export async function listAdminSocialLinks() {
  return await CommunitySocialLink.find({})
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
}

export async function listAdminResources() {
  return await CommunityResource.find({})
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
}