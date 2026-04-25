import mongoose from 'mongoose';

const CommunityEventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    content: {
      type: String,
      default: '',
      trim: true,
      maxlength: 5000,
    },
    type: {
      type: String,
      enum: ['event', 'launch', 'ama', 'contest', 'update'],
      default: 'event',
    },
    date: {
      type: String,
      required: true,
      trim: true,
    },
    startAt: {
      type: Date,
      default: null,
    },
    endAt: {
      type: Date,
      default: null,
    },
    ctaLabel: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    ctaUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    priority: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      default: 'admin',
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('CommunityEvent', CommunityEventSchema);