import mongoose from 'mongoose';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function signatureMatches(buffer, type) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  return type === 'image/webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function bucket() {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('Task media storage is unavailable'); error.status = 503; throw error;
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'taskProofMedia' });
}

export async function storeTaskProofImage({ buffer, contentType, filename, walletAddress }) {
  if (!ALLOWED_TYPES.has(contentType)) { const error = new Error('Only JPEG, PNG, and WebP images are allowed'); error.status = 415; throw error; }
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) { const error = new Error('Image must be between 1 byte and 5 MB'); error.status = 400; throw error; }
  if (!signatureMatches(buffer, contentType)) { const error = new Error('Image content does not match its declared file type'); error.status = 400; throw error; }
  const safeName = String(filename || 'task-proof').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const mediaBucket = bucket();
  return new Promise((resolve, reject) => {
    const upload = mediaBucket.openUploadStream(safeName, { contentType, metadata: { purpose: 'task-proof', walletAddress, uploadedAt: new Date() } });
    upload.on('error', reject);
    upload.on('finish', () => resolve({ id: upload.id.toString(), filename: safeName, contentType, size: buffer.length }));
    upload.end(buffer);
  });
}

export async function findTaskProofImage(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const mediaBucket = bucket();
  const files = await mediaBucket.find({ _id: new mongoose.Types.ObjectId(id), 'metadata.purpose': 'task-proof' }).limit(1).toArray();
  return files.length ? { bucket: mediaBucket, file: files[0] } : null;
}
