import mongoose from 'mongoose';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageSignatureMatches(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function mediaBucket() {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('Media storage is unavailable');
    error.status = 503;
    throw error;
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: 'notificationMedia',
  });
}

export async function storeNotificationImage({ buffer, contentType, filename = 'notification-image' }) {
  if (!ALLOWED_TYPES.has(contentType)) {
    const error = new Error('Only JPEG, PNG, and WebP images are allowed');
    error.status = 415;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image must be between 1 byte and 5 MB');
    error.status = 400;
    throw error;
  }
  if (!imageSignatureMatches(buffer, contentType)) {
    const error = new Error('Image content does not match its declared file type');
    error.status = 400;
    throw error;
  }

  const bucket = mediaBucket();
  const safeFilename = String(filename || 'notification-image')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 120);

  return new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(safeFilename, {
      contentType,
      metadata: {
        purpose: 'notification',
        uploadedAt: new Date(),
      },
    });
    upload.on('error', reject);
    upload.on('finish', () => resolve({
      id: upload.id.toString(),
      filename: safeFilename,
      contentType,
      size: buffer.length,
    }));
    upload.end(buffer);
  });
}

export async function findNotificationImage(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const bucket = mediaBucket();
  const files = await bucket.find({
    _id: new mongoose.Types.ObjectId(id),
    'metadata.purpose': 'notification',
  }).limit(1).toArray();
  if (!files.length) return null;
  return { bucket, file: files[0] };
}