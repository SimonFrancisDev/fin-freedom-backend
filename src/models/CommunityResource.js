import mongoose from 'mongoose';

const CommunityResourceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 60,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    route: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    href: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    icon: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('CommunityResource', CommunityResourceSchema);