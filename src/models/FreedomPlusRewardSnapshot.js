import mongoose from 'mongoose';

const eligibilitySchema = new mongoose.Schema({
  wallet: { type: String, required: true, lowercase: true },
  tier: { type: Number, required: true, min: 1, max: 3 },
  leaf: { type: String, required: true, lowercase: true },
  proof: [{ type: String, lowercase: true }],
}, { _id: false });

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  periodId: { type: Number, required: true, index: true },
  membershipAddress: { type: String, default: '', lowercase: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  cutoff: { type: Date, required: true, index: true },
  cutoffBlock: { type: Number, required: true },
  roots: [{ type: String, required: true, lowercase: true }],
  counts: [{ type: Number, required: true }],
  eligibility: [eligibilitySchema],
  sourceEventCount: { type: Number, required: true },
  proofDataAvailable: { type: Boolean, default: true, index: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  publishedTxHash: { type: String, default: '', lowercase: true },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, periodId: 1 }, { unique: true });
schema.index({ chainId: 1, periodId: 1, 'eligibility.wallet': 1 });

export default mongoose.model('FreedomPlusRewardSnapshot', schema);
