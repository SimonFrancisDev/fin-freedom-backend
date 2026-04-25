import mongoose from 'mongoose';

const IndexedRegistrationEventSchema = new mongoose.Schema(
  {
    chainId: {
      type: Number,
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    logIndex: {
      type: Number,
      required: true,
      index: true,
    },
    blockNumber: {
      type: Number,
      required: true,
      index: true,
    },
    blockHash: {
      type: String,
      required: true,
      lowercase: true,
    },
    contractAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    eventName: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: String,
      default: '',
      lowercase: true,
      index: true,
    },
    referrer: {
      type: String,
      default: '',
      lowercase: true,
      index: true,
    },
    level: {
      type: Number,
      default: 0,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

IndexedRegistrationEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
IndexedRegistrationEventSchema.index({ referrer: 1, eventName: 1, timestamp: -1 });
IndexedRegistrationEventSchema.index({ user: 1, eventName: 1, timestamp: -1 });

export default mongoose.model('IndexedRegistrationEvent', IndexedRegistrationEventSchema);