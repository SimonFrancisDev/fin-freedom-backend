import mongoose from 'mongoose';

const indexedEscrowEventSchema = new mongoose.Schema(
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
      trim: true,
      index: true,
    },

    logIndex: {
      type: Number,
      required: true,
      min: 0,
    },

    blockNumber: {
      type: Number,
      required: true,
      index: true,
      min: 0,
    },

    blockHash: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },

    contractAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    eventName: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    user: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    fromLevel: {
      type: Number,
      required: true,
      index: true,
      min: 1,
      max: 10,
    },

    toLevel: {
      type: Number,
      required: true,
      index: true,
      min: 1,
      max: 10,
    },

    amount: {
      type: String,
      required: true,
      default: '0',
    },

    newLockedTotal: {
      type: String,
      default: '0',
    },

    currentEscrowLockedGlobal: {
      type: String,
      default: '0',
    },

    recipient: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
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
    versionKey: false,
  }
);

indexedEscrowEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedEscrowEventSchema.index({ user: 1, fromLevel: 1, toLevel: 1, timestamp: -1 });
indexedEscrowEventSchema.index({ eventName: 1, timestamp: -1 });

const IndexedEscrowEvent = mongoose.model('IndexedEscrowEvent', indexedEscrowEventSchema);

export default IndexedEscrowEvent;