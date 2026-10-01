import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementTask', required: true, index: true },
  submissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskSubmission', required: true, unique: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
  rewardLabel: { type: String, default: '', trim: true, maxlength: 120 },
  status: { type: String, enum: ['pending', 'earned', 'issued', 'failed', 'cancelled'], default: 'earned', index: true },
  transactionHash: { type: String, default: '', trim: true, maxlength: 100 },
  note: { type: String, default: '', trim: true, maxlength: 1200 },
  issuedAt: { type: Date, default: null },
  updatedBy: { type: String, default: 'admin', trim: true, maxlength: 80 },
}, { timestamps: true, versionKey: false });
schema.index({ walletAddress: 1, createdAt: -1 });
export default mongoose.model('TaskReward', schema);
