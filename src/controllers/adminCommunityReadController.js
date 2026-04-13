import {
  listAdminAnnouncements,
  listAdminEvents,
  listAdminSocialLinks,
  listAdminResources,
} from '../services/admin/communityAdminReadService.js';

export async function getAdminAnnouncements(req, res, next) {
  try {
    const data = await listAdminAnnouncements();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminEvents(req, res, next) {
  try {
    const data = await listAdminEvents();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminSocialLinks(req, res, next) {
  try {
    const data = await listAdminSocialLinks();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminResources(req, res, next) {
  try {
    const data = await listAdminResources();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}