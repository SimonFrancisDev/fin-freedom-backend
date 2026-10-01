import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementTask', required: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 1200 },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskComment', default: null, index: true },
  isRemoved: { type: Boolean, default: false, index: true },
  removedAt: { type: Date, default: null },
  removedBy: { type: String, default: '', trim: true, maxlength: 80 },
}, { timestamps: true, versionKey: false });
schema.index({ taskId: 1, parentCommentId: 1, createdAt: 1 });
export default mongoose.model('TaskComment', schema);
