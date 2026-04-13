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

export async function createAnnouncement(payload = {}) {
  return await CommunityAnnouncement.create({
    title: requireNonEmptyString(payload.title, 'title'),
    content: requireNonEmptyString(payload.content, 'content'),
    type: payload.type || 'info',
    date: requireNonEmptyString(payload.date, 'date'),
    priority: Number(payload.priority || 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    createdBy: payload.createdBy || 'admin',
  });
}

export async function updateAnnouncement(id, payload = {}) {
  const doc = await CommunityAnnouncement.findByIdAndUpdate(
    id,
    {
      $set: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        ...(payload.type !== undefined ? { type: payload.type } : {}),
        ...(payload.date !== undefined ? { date: payload.date } : {}),
        ...(payload.priority !== undefined ? { priority: Number(payload.priority) } : {}),
        ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
      },
    },
    { new: true, runValidators: true }
  );

  if (!doc) {
    const error = new Error('Announcement not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function deleteAnnouncement(id) {
  const doc = await CommunityAnnouncement.findByIdAndDelete(id);

  if (!doc) {
    const error = new Error('Announcement not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function createEvent(payload = {}) {
  return await CommunityEvent.create({
    title: requireNonEmptyString(payload.title, 'title'),
    content: payload.content || '',
    type: payload.type || 'event',
    date: requireNonEmptyString(payload.date, 'date'),
    startAt: payload.startAt || null,
    endAt: payload.endAt || null,
    ctaLabel: payload.ctaLabel || '',
    ctaUrl: payload.ctaUrl || '',
    priority: Number(payload.priority || 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    createdBy: payload.createdBy || 'admin',
  });
}

export async function updateEvent(id, payload = {}) {
  const doc = await CommunityEvent.findByIdAndUpdate(
    id,
    {
      $set: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        ...(payload.type !== undefined ? { type: payload.type } : {}),
        ...(payload.date !== undefined ? { date: payload.date } : {}),
        ...(payload.startAt !== undefined ? { startAt: payload.startAt || null } : {}),
        ...(payload.endAt !== undefined ? { endAt: payload.endAt || null } : {}),
        ...(payload.ctaLabel !== undefined ? { ctaLabel: payload.ctaLabel } : {}),
        ...(payload.ctaUrl !== undefined ? { ctaUrl: payload.ctaUrl } : {}),
        ...(payload.priority !== undefined ? { priority: Number(payload.priority) } : {}),
        ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
      },
    },
    { new: true, runValidators: true }
  );

  if (!doc) {
    const error = new Error('Event not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function deleteEvent(id) {
  const doc = await CommunityEvent.findByIdAndDelete(id);

  if (!doc) {
    const error = new Error('Event not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function createSocialLink(payload = {}) {
  return await CommunitySocialLink.create({
    key: requireNonEmptyString(payload.key, 'key'),
    label: requireNonEmptyString(payload.label, 'label'),
    href: requireNonEmptyString(payload.href, 'href'),
    icon: requireNonEmptyString(payload.icon, 'icon'),
    sortOrder: Number(payload.sortOrder || 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  });
}

export async function updateSocialLink(id, payload = {}) {
  const doc = await CommunitySocialLink.findByIdAndUpdate(
    id,
    {
      $set: {
        ...(payload.key !== undefined ? { key: payload.key } : {}),
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.href !== undefined ? { href: payload.href } : {}),
        ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: Number(payload.sortOrder) } : {}),
        ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
      },
    },
    { new: true, runValidators: true }
  );

  if (!doc) {
    const error = new Error('Social link not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function deleteSocialLink(id) {
  const doc = await CommunitySocialLink.findByIdAndDelete(id);

  if (!doc) {
    const error = new Error('Social link not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function createResource(payload = {}) {
  return await CommunityResource.create({
    key: requireNonEmptyString(payload.key, 'key'),
    label: requireNonEmptyString(payload.label, 'label'),
    route: payload.route || '',
    href: payload.href || '',
    icon: requireNonEmptyString(payload.icon, 'icon'),
    sortOrder: Number(payload.sortOrder || 0),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
  });
}

export async function updateResource(id, payload = {}) {
  const doc = await CommunityResource.findByIdAndUpdate(
    id,
    {
      $set: {
        ...(payload.key !== undefined ? { key: payload.key } : {}),
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.route !== undefined ? { route: payload.route } : {}),
        ...(payload.href !== undefined ? { href: payload.href } : {}),
        ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: Number(payload.sortOrder) } : {}),
        ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
      },
    },
    { new: true, runValidators: true }
  );

  if (!doc) {
    const error = new Error('Resource not found');
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function deleteResource(id) {
  const doc = await CommunityResource.findByIdAndDelete(id);

  if (!doc) {
    const error = new Error('Resource not found');
    error.status = 404;
    throw error;
  }

  return doc;
}