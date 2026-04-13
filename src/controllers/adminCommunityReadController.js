import {
  listAdminAnnouncements,
  listAdminEvents,
  listAdminSocialLinks,
  listAdminResources,
} from '../services/admin/communityAdminReadService.js';

function setAdminReadCacheHeaders(res) {
  res.set('Cache-Control', 'private, max-age=5, stale-while-revalidate=5');
}

export async function getAdminAnnouncements(req, res, next) {
  try {
    const data = await listAdminAnnouncements();
    setAdminReadCacheHeaders(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminEvents(req, res, next) {
  try {
    const data = await listAdminEvents();
    setAdminReadCacheHeaders(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminSocialLinks(req, res, next) {
  try {
    const data = await listAdminSocialLinks();
    setAdminReadCacheHeaders(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminResources(req, res, next) {
  try {
    const data = await listAdminResources();
    setAdminReadCacheHeaders(res);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}













// import {
//   listAdminAnnouncements,
//   listAdminEvents,
//   listAdminSocialLinks,
//   listAdminResources,
// } from '../services/admin/communityAdminReadService.js';

// export async function getAdminAnnouncements(req, res, next) {
//   try {
//     const data = await listAdminAnnouncements();
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getAdminEvents(req, res, next) {
//   try {
//     const data = await listAdminEvents();
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getAdminSocialLinks(req, res, next) {
//   try {
//     const data = await listAdminSocialLinks();
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }

// export async function getAdminResources(req, res, next) {
//   try {
//     const data = await listAdminResources();
//     res.status(200).json({ ok: true, data });
//   } catch (error) {
//     next(error);
//   }
// }