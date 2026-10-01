import mongoose from 'mongoose';

const engagementTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  summary: { type: String, required: true, trim: true, maxlength: 320 },
  instructions: { type: String, required: true, trim: true, maxlength: 4000 },
  actionUrl: { type: String, default: '', trim: true, maxlength: 500 },
  imageId: { type: String, default: '', trim: true, maxlength: 80 },
  imageUrl: { type: String, default: '', trim: true, maxlength: 240 },
  rewardLabel: { type: String, default: '', trim: true, maxlength: 120 },
  proofRequirements: { type: String, default: '', trim: true, maxlength: 1000 },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  status: { type: String, enum: ['draft', 'published', 'closed', 'archived'], default: 'draft', index: true },
  createdBy: { type: String, default: 'admin', trim: true, maxlength: 80 },
}, { timestamps: true, versionKey: false });

engagementTaskSchema.index({ status: 1, startsAt: 1, endsAt: 1, createdAt: -1 });

export default mongoose.model('EngagementTask', engagementTaskSchema);
