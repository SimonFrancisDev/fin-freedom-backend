import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementTask', required: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
  status: { type: String, enum: ['joined', 'submitted', 'completed'], default: 'joined', index: true },
  joinedAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false });
schema.index({ taskId: 1, walletAddress: 1 }, { unique: true });
export default mongoose.model('TaskParticipation', schema);
