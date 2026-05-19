import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    chainId: { type: Number, required: true, index: true },
    notificationType: { type: String, required: true, trim: true, index: true },
    severity: {
      type: String,
      enum: ['info', 'success', 'warning', 'danger', 'critical'],
      default: 'info',
      index: true,
    },
    status: {
      type: String,
      enum: ['unread', 'read', 'cleared'],
      default: 'unread',
      index: true,
    },
    source: { type: String, default: 'indexer', trim: true, index: true },
    sourceEventName: { type: String, default: '', trim: true, index: true },
    txHash: { type: String, default: '', lowercase: true, trim: true, index: true },
    logIndex: { type: Number, default: null },
    blockNumber: { type: Number, default: null, index: true },
    contractAddress: { type: String, default: '', lowercase: true, trim: true },
    dedupeKey: { type: String, required: true, unique: true, trim: true, index: true },
    titleKey: { type: String, required: true, trim: true },
    messageKey: { type: String, required: true, trim: true },
    detailKey: { type: String, default: '', trim: true },
    i18nParams: { type: mongoose.Schema.Types.Mixed, default: {} },
    route: { type: String, default: '', trim: true },
    routeParams: { type: mongoose.Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
    clearedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false }
);

notificationSchema.index({ walletAddress: 1, status: 1, createdAt: -1 });
notificationSchema.index({ notificationType: 1, severity: 1, createdAt: -1 });
notificationSchema.index({ txHash: 1, logIndex: 1, notificationType: 1 });

export default mongoose.model('Notification', notificationSchema);
