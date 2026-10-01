import { findNotificationImage } from '../services/notifications/notificationMediaService.js';

export async function getNotificationMedia(req, res, next) {
  try {
    const result = await findNotificationImage(req.params.id);
    if (!result) {
      return res.status(404).json({ ok: false, message: 'Notification image not found' });
    }

    res.set({
      'Content-Type': result.file.contentType || 'application/octet-stream',
      'Content-Length': String(result.file.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });

    result.bucket.openDownloadStream(result.file._id)
      .on('error', next)
      .pipe(res);
  } catch (error) {
    next(error);
  }
}