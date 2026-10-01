import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true },
  wallet: { type: String, required: true, lowercase: true, index: true },
  level: { type: Number, required: true, min: 1, max: 7 },
  active: { type: Boolean, default: false, index: true },
  activationId: { type: String, default: '', lowercase: true, index: true },
  genesis: { type: Boolean, default: false, index: true },
  activatedAtBlock: { type: Number, default: 0, index: true },
  activatedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, wallet: 1, level: 1 }, { unique: true });

export default mongoose.model('FreedomPlusLevelState', schema);
