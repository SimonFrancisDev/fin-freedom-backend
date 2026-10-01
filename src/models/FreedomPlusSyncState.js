import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true },
  contractKey: { type: String, required: true },
  lastProcessedBlock: { type: Number, required: true, min: 0 },
  lastProcessedBlockHash: { type: String, default: '', lowercase: true },
  status: { type: String, enum: ['idle', 'running', 'error'], default: 'idle', index: true },
  lastSyncedAt: { type: Date, default: null },
  errorMessage: { type: String, default: '' },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, contractKey: 1 }, { unique: true });

export default mongoose.model('FreedomPlusSyncState', schema);
