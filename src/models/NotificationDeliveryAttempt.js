import mongoose from 'mongoose';

const notificationDeliveryAttemptSchema = new mongoose.Schema(
  {
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null, index: true },
    walletAddress: { type: String, default: '', lowercase: true, trim: true, index: true },
    channel: { type: String, enum: ['telegram'], required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    attemptCount: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: '' },
    nextRetryAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

notificationDeliveryAttemptSchema.index({ status: 1, nextRetryAt: 1 });

export default mongoose.model('NotificationDeliveryAttempt', notificationDeliveryAttemptSchema);
