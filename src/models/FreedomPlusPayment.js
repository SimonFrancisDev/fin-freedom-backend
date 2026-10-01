import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  activationId: { type: String, required: true, lowercase: true, index: true },
  role: { type: Number, required: true, min: 1, max: 3 },
  level: { type: Number, required: true, min: 1, max: 7, index: true },
  recipient: { type: String, required: true, lowercase: true, index: true },
  originalCandidate: { type: String, required: true, lowercase: true },
  bps: { type: Number, required: true },
  amount: { type: String, required: true },
  id1Fallback: { type: Boolean, required: true, index: true },
  distributedToFounders: { type: Boolean, default: false },
  placementId: { type: String, default: '', lowercase: true },
  txHash: { type: String, required: true, lowercase: true },
  blockNumber: { type: Number, required: true, index: true },
  timestamp: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, activationId: 1, role: 1 }, { unique: true });
schema.index({ chainId: 1, recipient: 1, blockNumber: -1 });

export default mongoose.model('FreedomPlusPayment', schema);
