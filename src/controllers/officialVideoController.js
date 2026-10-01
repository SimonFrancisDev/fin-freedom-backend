import {
  getOfficialVideoForAdmin,
  getPublishedOfficialVideo,
  saveOfficialVideo,
} from '../services/community/officialVideoService.js';

export async function getAdminOfficialVideo(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await getOfficialVideoForAdmin() });
  } catch (error) {
    next(error);
  }
}

export async function putAdminOfficialVideo(req, res, next) {
  try {
    const data = await saveOfficialVideo(req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getPublicOfficialVideo(req, res, next) {
  try {
    const data = await getPublishedOfficialVideo();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}