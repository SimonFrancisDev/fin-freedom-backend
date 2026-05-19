import mongoose from 'mongoose';

const telegramSubscriptionSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    telegramUserId: { type: String, default: '', trim: true, index: true },
    chatId: { type: String, default: '', trim: true, index: true },
    username: { type: String, default: '', trim: true },
    language: { type: String, default: 'en', trim: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'unsubscribed', 'blocked'],
      default: 'pending',
      index: true,
    },
    verificationCodeHash: { type: String, default: '', trim: true },
    verificationExpiresAt: { type: Date, default: null, index: true },
    preferences: {
      paymentReceived: { type: Boolean, default: true },
      paymentSkipped: { type: Boolean, default: true },
      escrow: { type: Boolean, default: true },
      autoUpgrade: { type: Boolean, default: true },
      recycle: { type: Boolean, default: true },
      tokenRewards: { type: Boolean, default: true },
      systemNotices: { type: Boolean, default: true },
      communityNotices: { type: Boolean, default: true },
    },
    lastDeliveredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

telegramSubscriptionSchema.index({ walletAddress: 1, status: 1 });
telegramSubscriptionSchema.index({ chatId: 1, walletAddress: 1 }, { unique: true, sparse: true });

export default mongoose.model('TelegramSubscription', telegramSubscriptionSchema);
