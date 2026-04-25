import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
import CommunityEvent from '../../models/CommunityEvent.js';
import CommunitySocialLink from '../../models/CommunitySocialLink.js';
import CommunityResource from '../../models/CommunityResource.js';

const CACHE_TTL_MS = 5000;
const cache = new Map();
const inflight = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function cached(key, fn, ttlMs = CACHE_TTL_MS) {
  const existing = getCache(key);
  if (existing) return existing;

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      const result = await fn();
      setCache(key, result, ttlMs);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function listAdminAnnouncements() {
  return cached('admin:community:announcements', async () => {
    return CommunityAnnouncement.find({})
      .sort({ priority: -1, createdAt: -1 })
      .lean();
  });
}

export async function listAdminEvents() {
  return cached('admin:community:events', async () => {
    return CommunityEvent.find({})
      .sort({ priority: -1, startAt: 1, createdAt: -1 })
      .lean();
  });
}

export async function listAdminSocialLinks() {
  return cached('admin:community:social-links', async () => {
    return CommunitySocialLink.find({})
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
  });
}

export async function listAdminResources() {
  return cached('admin:community:resources', async () => {
    return CommunityResource.find({})
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
  });
}










// import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
// import CommunityEvent from '../../models/CommunityEvent.js';
// import CommunitySocialLink from '../../models/CommunitySocialLink.js';
// import CommunityResource from '../../models/CommunityResource.js';

// export async function listAdminAnnouncements() {
//   return await CommunityAnnouncement.find({})
//     .sort({ priority: -1, createdAt: -1 })
//     .lean();
// }

// export async function listAdminEvents() {
//   return await CommunityEvent.find({})
//     .sort({ priority: -1, startAt: 1, createdAt: -1 })
//     .lean();
// }

// export async function listAdminSocialLinks() {
//   return await CommunitySocialLink.find({})
//     .sort({ sortOrder: 1, createdAt: 1 })
//     .lean();
// }

// export async function listAdminResources() {
//   return await CommunityResource.find({})
//     .sort({ sortOrder: 1, createdAt: 1 })
//     .lean();
// }