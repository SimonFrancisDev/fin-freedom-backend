import mongoose from 'mongoose';

const CommunityAnnouncementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    type: {
      type: String,
      enum: ['info', 'success', 'warning', 'event'],
      default: 'info',
    },
    date: {
      type: String,
      required: true,
      trim: true,
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

export default mongoose.model('CommunityAnnouncement', CommunityAnnouncementSchema);