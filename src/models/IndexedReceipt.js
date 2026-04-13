import mongoose from 'mongoose';

const indexedReceiptSchema = new mongoose.Schema(
  {
    chainId: {
      type: Number,
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
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

    receiver: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    activationId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    receiptType: {
      type: Number,
      required: true,
      index: true,
      min: 0,
    },
    level: {
      type: Number,
      required: true,
      index: true,
      min: 1,
      max: 10,
    },
    fromUser: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    orbitOwner: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    sourcePosition: {
      type: Number,
      required: true,
      min: 0,
    },
    sourceCycle: {
      type: Number,
      required: true,
      min: 0,
    },
    mirroredPosition: {
      type: Number,
      required: true,
      min: 0,
    },
    mirroredCycle: {
      type: Number,
      required: true,
      min: 0,
    },
    routedRole: {
      type: Number,
      required: true,
      min: 0,
    },

    grossAmount: {
      type: String,
      required: true,
      default: '0',
    },
    escrowLocked: {
      type: String,
      required: true,
      default: '0',
    },
    liquidPaid: {
      type: String,
      required: true,
      default: '0',
    },

    timestamp: {
      type: Date,
      required: true,
      index: true,
    },

    rawEventName: {
      type: String,
      default: 'DetailedPayoutReceiptRecorded',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

indexedReceiptSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedReceiptSchema.index({ receiver: 1, level: 1, timestamp: -1 });
indexedReceiptSchema.index({ activationId: 1, timestamp: 1 });
indexedReceiptSchema.index({ orbitOwner: 1, level: 1, sourceCycle: 1, sourcePosition: 1 });
indexedReceiptSchema.index({ fromUser: 1, level: 1, timestamp: -1 });

const IndexedReceipt = mongoose.model('IndexedReceipt', indexedReceiptSchema);

export default IndexedReceipt;