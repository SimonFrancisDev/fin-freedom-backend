import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
import CommunityEvent from '../../models/CommunityEvent.js';
import CommunitySocialLink from '../../models/CommunitySocialLink.js';
import CommunityResource from '../../models/CommunityResource.js';

function requireNonEmptyString(value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${fieldName} is required`);
    error.status = 400;
    throw error;
  }

  return value.trim();
}

function optionalTrimmedString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableValue(value) {
  return value || null;
}

async function requireDocument(docPromise, label) {
  const doc = await docPromise;
  if (!doc) {
    const error = new Error(`${label} not found`);
    error.status = 404;
    throw error;
  }
  return doc;
}

export async function createAnnouncement(payload = {}) {
  return CommunityAnnouncement.create({
    title: requireNonEmptyString(payload.title, 'title'),
    content: requireNonEmptyString(payload.content, 'content'),
    type: optionalTrimmedString(payload.type, 'info') || 'info',
    date: requireNonEmptyString(payload.date, 'date'),
    priority: toSafeNumber(payload.priority, 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    createdBy: optionalTrimmedString(payload.createdBy, 'admin') || 'admin',
  });
}

export async function updateAnnouncement(id, payload = {}) {
  const doc = await requireDocument(
    CommunityAnnouncement.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(payload.title !== undefined ? { title: optionalTrimmedString(payload.title) } : {}),
          ...(payload.content !== undefined ? { content: optionalTrimmedString(payload.content) } : {}),
          ...(payload.type !== undefined ? { type: optionalTrimmedString(payload.type) } : {}),
          ...(payload.date !== undefined ? { date: optionalTrimmedString(payload.date) } : {}),
          ...(payload.priority !== undefined ? { priority: toSafeNumber(payload.priority, 0) } : {}),
          ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
        },
      },
      { new: true, runValidators: true }
    ),
    'Announcement'
  );

  return doc;
}

export async function deleteAnnouncement(id) {
  return requireDocument(CommunityAnnouncement.findByIdAndDelete(id), 'Announcement');
}

export async function createEvent(payload = {}) {
  return CommunityEvent.create({
    title: requireNonEmptyString(payload.title, 'title'),
    content: optionalTrimmedString(payload.content, ''),
    type: optionalTrimmedString(payload.type, 'event') || 'event',
    date: requireNonEmptyString(payload.date, 'date'),
    startAt: toNullableValue(payload.startAt),
    endAt: toNullableValue(payload.endAt),
    ctaLabel: optionalTrimmedString(payload.ctaLabel, ''),
    ctaUrl: optionalTrimmedString(payload.ctaUrl, ''),
    priority: toSafeNumber(payload.priority, 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    createdBy: optionalTrimmedString(payload.createdBy, 'admin') || 'admin',
  });
}

export async function updateEvent(id, payload = {}) {
  const doc = await requireDocument(
    CommunityEvent.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(payload.title !== undefined ? { title: optionalTrimmedString(payload.title) } : {}),
          ...(payload.content !== undefined ? { content: optionalTrimmedString(payload.content) } : {}),
          ...(payload.type !== undefined ? { type: optionalTrimmedString(payload.type) } : {}),
          ...(payload.date !== undefined ? { date: optionalTrimmedString(payload.date) } : {}),
          ...(payload.startAt !== undefined ? { startAt: toNullableValue(payload.startAt) } : {}),
          ...(payload.endAt !== undefined ? { endAt: toNullableValue(payload.endAt) } : {}),
          ...(payload.ctaLabel !== undefined ? { ctaLabel: optionalTrimmedString(payload.ctaLabel) } : {}),
          ...(payload.ctaUrl !== undefined ? { ctaUrl: optionalTrimmedString(payload.ctaUrl) } : {}),
          ...(payload.priority !== undefined ? { priority: toSafeNumber(payload.priority, 0) } : {}),
          ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
        },
      },
      { new: true, runValidators: true }
    ),
    'Event'
  );

  return doc;
}

export async function deleteEvent(id) {
  return requireDocument(CommunityEvent.findByIdAndDelete(id), 'Event');
}

export async function createSocialLink(payload = {}) {
  return CommunitySocialLink.create({
    key: requireNonEmptyString(payload.key, 'key'),
    label: requireNonEmptyString(payload.label, 'label'),
    href: requireNonEmptyString(payload.href, 'href'),
    icon: requireNonEmptyString(payload.icon, 'icon'),
    sortOrder: toSafeNumber(payload.sortOrder, 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  });
}

export async function updateSocialLink(id, payload = {}) {
  const doc = await requireDocument(
    CommunitySocialLink.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(payload.key !== undefined ? { key: optionalTrimmedString(payload.key) } : {}),
          ...(payload.label !== undefined ? { label: optionalTrimmedString(payload.label) } : {}),
          ...(payload.href !== undefined ? { href: optionalTrimmedString(payload.href) } : {}),
          ...(payload.icon !== undefined ? { icon: optionalTrimmedString(payload.icon) } : {}),
          ...(payload.sortOrder !== undefined ? { sortOrder: toSafeNumber(payload.sortOrder, 0) } : {}),
          ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
        },
      },
      { new: true, runValidators: true }
    ),
    'Social link'
  );

  return doc;
}

export async function deleteSocialLink(id) {
  return requireDocument(CommunitySocialLink.findByIdAndDelete(id), 'Social link');
}

export async function createResource(payload = {}) {
  return CommunityResource.create({
    key: requireNonEmptyString(payload.key, 'key'),
    label: requireNonEmptyString(payload.label, 'label'),
    route: optionalTrimmedString(payload.route, ''),
    href: optionalTrimmedString(payload.href, ''),
    icon: requireNonEmptyString(payload.icon, 'icon'),
    sortOrder: toSafeNumber(payload.sortOrder, 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  });
}

export async function updateResource(id, payload = {}) {
  const doc = await requireDocument(
    CommunityResource.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(payload.key !== undefined ? { key: optionalTrimmedString(payload.key) } : {}),
          ...(payload.label !== undefined ? { label: optionalTrimmedString(payload.label) } : {}),
          ...(payload.route !== undefined ? { route: optionalTrimmedString(payload.route) } : {}),
          ...(payload.href !== undefined ? { href: optionalTrimmedString(payload.href) } : {}),
          ...(payload.icon !== undefined ? { icon: optionalTrimmedString(payload.icon) } : {}),
          ...(payload.sortOrder !== undefined ? { sortOrder: toSafeNumber(payload.sortOrder, 0) } : {}),
          ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
        },
      },
      { new: true, runValidators: true }
    ),
    'Resource'
  );

  return doc;
}

export async function deleteResource(id) {
  return requireDocument(CommunityResource.findByIdAndDelete(id), 'Resource');
}









// import CommunityAnnouncement from '../../models/CommunityAnnouncement.js';
// import CommunityEvent from '../../models/CommunityEvent.js';
// import CommunitySocialLink from '../../models/CommunitySocialLink.js';
// import CommunityResource from '../../models/CommunityResource.js';

// function requireNonEmptyString(value, fieldName) {
//   if (!value || typeof value !== 'string' || !value.trim()) {
//     const error = new Error(`${fieldName} is required`);
//     error.status = 400;
//     throw error;
//   }

//   return value.trim();
// }

// export async function createAnnouncement(payload = {}) {
//   return await CommunityAnnouncement.create({
//     title: requireNonEmptyString(payload.title, 'title'),
//     content: requireNonEmptyString(payload.content, 'content'),
//     type: payload.type || 'info',
//     date: requireNonEmptyString(payload.date, 'date'),
//     priority: Number(payload.priority || 0),
//     isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
//     createdBy: payload.createdBy || 'admin',
//   });
// }

// export async function updateAnnouncement(id, payload = {}) {
//   const doc = await CommunityAnnouncement.findByIdAndUpdate(
//     id,
//     {
//       $set: {
//         ...(payload.title !== undefined ? { title: payload.title } : {}),
//         ...(payload.content !== undefined ? { content: payload.content } : {}),
//         ...(payload.type !== undefined ? { type: payload.type } : {}),
//         ...(payload.date !== undefined ? { date: payload.date } : {}),
//         ...(payload.priority !== undefined ? { priority: Number(payload.priority) } : {}),
//         ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
//       },
//     },
//     { new: true, runValidators: true }
//   );

//   if (!doc) {
//     const error = new Error('Announcement not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function deleteAnnouncement(id) {
//   const doc = await CommunityAnnouncement.findByIdAndDelete(id);

//   if (!doc) {
//     const error = new Error('Announcement not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function createEvent(payload = {}) {
//   return await CommunityEvent.create({
//     title: requireNonEmptyString(payload.title, 'title'),
//     content: payload.content || '',
//     type: payload.type || 'event',
//     date: requireNonEmptyString(payload.date, 'date'),
//     startAt: payload.startAt || null,
//     endAt: payload.endAt || null,
//     ctaLabel: payload.ctaLabel || '',
//     ctaUrl: payload.ctaUrl || '',
//     priority: Number(payload.priority || 0),
//     isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
//     createdBy: payload.createdBy || 'admin',
//   });
// }

// export async function updateEvent(id, payload = {}) {
//   const doc = await CommunityEvent.findByIdAndUpdate(
//     id,
//     {
//       $set: {
//         ...(payload.title !== undefined ? { title: payload.title } : {}),
//         ...(payload.content !== undefined ? { content: payload.content } : {}),
//         ...(payload.type !== undefined ? { type: payload.type } : {}),
//         ...(payload.date !== undefined ? { date: payload.date } : {}),
//         ...(payload.startAt !== undefined ? { startAt: payload.startAt || null } : {}),
//         ...(payload.endAt !== undefined ? { endAt: payload.endAt || null } : {}),
//         ...(payload.ctaLabel !== undefined ? { ctaLabel: payload.ctaLabel } : {}),
//         ...(payload.ctaUrl !== undefined ? { ctaUrl: payload.ctaUrl } : {}),
//         ...(payload.priority !== undefined ? { priority: Number(payload.priority) } : {}),
//         ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
//       },
//     },
//     { new: true, runValidators: true }
//   );

//   if (!doc) {
//     const error = new Error('Event not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function deleteEvent(id) {
//   const doc = await CommunityEvent.findByIdAndDelete(id);

//   if (!doc) {
//     const error = new Error('Event not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function createSocialLink(payload = {}) {
//   return await CommunitySocialLink.create({
//     key: requireNonEmptyString(payload.key, 'key'),
//     label: requireNonEmptyString(payload.label, 'label'),
//     href: requireNonEmptyString(payload.href, 'href'),
//     icon: requireNonEmptyString(payload.icon, 'icon'),
//     sortOrder: Number(payload.sortOrder || 0),
//     isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
//   });
// }

// export async function updateSocialLink(id, payload = {}) {
//   const doc = await CommunitySocialLink.findByIdAndUpdate(
//     id,
//     {
//       $set: {
//         ...(payload.key !== undefined ? { key: payload.key } : {}),
//         ...(payload.label !== undefined ? { label: payload.label } : {}),
//         ...(payload.href !== undefined ? { href: payload.href } : {}),
//         ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
//         ...(payload.sortOrder !== undefined ? { sortOrder: Number(payload.sortOrder) } : {}),
//         ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
//       },
//     },
//     { new: true, runValidators: true }
//   );

//   if (!doc) {
//     const error = new Error('Social link not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function deleteSocialLink(id) {
//   const doc = await CommunitySocialLink.findByIdAndDelete(id);

//   if (!doc) {
//     const error = new Error('Social link not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function createResource(payload = {}) {
//   return await CommunityResource.create({
//     key: requireNonEmptyString(payload.key, 'key'),
//     label: requireNonEmptyString(payload.label, 'label'),
//     route: payload.route || '',
//     href: payload.href || '',
//     icon: requireNonEmptyString(payload.icon, 'icon'),
//     sortOrder: Number(payload.sortOrder || 0),
//     isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
//   });
// }

// export async function updateResource(id, payload = {}) {
//   const doc = await CommunityResource.findByIdAndUpdate(
//     id,
//     {
//       $set: {
//         ...(payload.key !== undefined ? { key: payload.key } : {}),
//         ...(payload.label !== undefined ? { label: payload.label } : {}),
//         ...(payload.route !== undefined ? { route: payload.route } : {}),
//         ...(payload.href !== undefined ? { href: payload.href } : {}),
//         ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
//         ...(payload.sortOrder !== undefined ? { sortOrder: Number(payload.sortOrder) } : {}),
//         ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
//       },
//     },
//     { new: true, runValidators: true }
//   );

//   if (!doc) {
//     const error = new Error('Resource not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }

// export async function deleteResource(id) {
//   const doc = await CommunityResource.findByIdAndDelete(id);

//   if (!doc) {
//     const error = new Error('Resource not found');
//     error.status = 404;
//     throw error;
//   }

//   return doc;
// }