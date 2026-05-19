import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    paymentReceived: { type: Boolean, default: true },
    paymentSkipped: { type: Boolean, default: true },
    escrow: { type: Boolean, default: true },
    autoUpgrade: { type: Boolean, default: true },
    recycle: { type: Boolean, default: true },
    tokenRewards: { type: Boolean, default: true },
    systemNotices: { type: Boolean, default: true },
    communityNotices: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationPreferenceSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    language: { type: String, default: 'en', trim: true },
    web: { type: categorySchema, default: () => ({}) },
    telegram: { type: categorySchema, default: () => ({}) },
    telegramEnabled: { type: Boolean, default: false },
    digestEnabled: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

export default mongoose.model('NotificationPreference', notificationPreferenceSchema);
