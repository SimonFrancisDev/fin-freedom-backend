import mongoose from 'mongoose';

const profilePrivacySchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const ProfilePrivacy = mongoose.model('ProfilePrivacy', profilePrivacySchema);

export default ProfilePrivacy;
