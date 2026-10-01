import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementTask', required: true, index: true },
  targetType: { type: String, enum: ['task', 'comment', 'submission'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
  reaction: { type: String, enum: ['applaud', 'like', 'celebrate'], default: 'applaud' },
}, { timestamps: true, versionKey: false });
schema.index({ targetType: 1, targetId: 1, walletAddress: 1 }, { unique: true });
schema.index({ taskId: 1, targetType: 1, createdAt: -1 });
export default mongoose.model('TaskReaction', schema);
