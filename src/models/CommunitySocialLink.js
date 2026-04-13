import mongoose from 'mongoose';

const CommunitySocialLinkSchema = new mongoose.Schema(
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
    href: {
      type: String,
      required: true,
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

export default mongoose.model('CommunitySocialLink', CommunitySocialLinkSchema);