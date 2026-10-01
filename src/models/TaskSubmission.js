import mongoose from 'mongoose';

const taskSubmissionSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementTask', required: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
  proofText: { type: String, default: '', trim: true, maxlength: 3000 },
  proofUrl: { type: String, default: '', trim: true, maxlength: 500 },
  proofImageId: { type: String, default: '', trim: true, maxlength: 80 },
  status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted', index: true },
  reviewNote: { type: String, default: '', trim: true, maxlength: 1200 },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: String, default: '', trim: true, maxlength: 80 },
}, { timestamps: true, versionKey: false });

taskSubmissionSchema.index({ taskId: 1, walletAddress: 1 }, { unique: true });
taskSubmissionSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('TaskSubmission', taskSubmissionSchema);
