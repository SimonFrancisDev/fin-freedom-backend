import OfficialVideo from '../../models/OfficialVideo.js';

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function parseYoutubeVideoId(value) {
  const raw = String(value || '').trim();
  if (!raw) fail('YouTube URL is required');
  if (VIDEO_ID_PATTERN.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('Enter a valid YouTube URL');
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host) || url.protocol !== 'https:') {
    fail('Only HTTPS YouTube URLs are allowed');
  }

  let id = '';
  if (host.endsWith('youtu.be')) {
    id = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v') || '';
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1] || '';
  }

  if (!VIDEO_ID_PATTERN.test(id)) fail('YouTube video ID is invalid');
  return id;
}

function serialize(video) {
  if (!video) return null;
  const item = video.toObject ? video.toObject() : video;
  return {
    ...item,
    thumbnailUrl: `https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${item.youtubeId}`,
  };
}

export async function getOfficialVideoForAdmin() {
  return serialize(await OfficialVideo.findOne({ key: 'official' }).lean());
}

export async function getPublishedOfficialVideo() {
  return serialize(await OfficialVideo.findOne({ key: 'official', isPublished: true }).lean());
}

export async function saveOfficialVideo(payload = {}) {
  const youtubeId = parseYoutubeVideoId(payload.youtubeUrl || payload.youtubeId);
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  if (!title) fail('Title is required');
  if (title.length > 140) fail('Title must be 140 characters or fewer');
  if (description.length > 1200) fail('Description must be 1200 characters or fewer');

  const video = await OfficialVideo.findOneAndUpdate(
    { key: 'official' },
    {
      $set: {
        youtubeId,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
        title,
        description,
        isPublished: Boolean(payload.isPublished),
        updatedBy: String(payload.updatedBy || 'admin').trim().slice(0, 80) || 'admin',
      },
      $setOnInsert: { key: 'official' },
    },
    { new: true, upsert: true, runValidators: true }
  );

  return serialize(video);
}