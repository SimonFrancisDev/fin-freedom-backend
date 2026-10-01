import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true },
  distributor: { type: String, required: true, lowercase: true },
  periodId: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'running', 'complete', 'empty'], default: 'pending' },
  cursor: { type: Number, default: 0 },
  poolAmount: { type: String, default: '' },
  leaseOwner: { type: String, default: '' },
  leaseUntil: { type: Date, default: () => new Date(0) },
  transactionHashes: [{ type: String }],
  lastError: { type: String, default: '' },
}, { timestamps: true, versionKey: false });
schema.index({ chainId: 1, distributor: 1, periodId: 1 }, { unique: true });
export default mongoose.model('NftRewardDistributionJob', schema);
