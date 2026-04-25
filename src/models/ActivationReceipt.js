import mongoose from 'mongoose';

const activationReceiptSchema = new mongoose.Schema(
  {
    activationId: {
      type: Number,
      required: true,
      index: true
    },
    receiver: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    level: {
      type: Number,
      required: true,
      index: true
    },
    receiptType: {
      type: Number,
      required: true,
      index: true
    },
    fromUser: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    orbitOwner: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    sourcePosition: {
      type: Number,
      default: 0
    },
    sourceCycle: {
      type: Number,
      default: 0
    },
    mirroredPosition: {
      type: Number,
      default: 0
    },
    mirroredCycle: {
      type: Number,
      default: 0
    },
    routedRole: {
      type: Number,
      default: 0,
      index: true
    },
    grossAmount: {
      type: String,
      required: true,
      default: '0'
    },
    escrowLocked: {
      type: String,
      required: true,
      default: '0'
    },
    liquidPaid: {
      type: String,
      required: true,
      default: '0'
    },
    blockNumber: {
      type: Number,
      required: true,
      index: true
    },
    blockHash: {
      type: String,
      required: true
    },
    transactionHash: {
      type: String,
      required: true,
      index: true
    },
    logIndex: {
      type: Number,
      required: true
    },
    timestamp: {
      type: Number,
      required: true,
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

activationReceiptSchema.index(
  { transactionHash: 1, logIndex: 1 },
  { unique: true }
);

activationReceiptSchema.index(
  { receiver: 1, level: 1, timestamp: -1 }
);

activationReceiptSchema.index(
  { activationId: 1, timestamp: 1 }
);

activationReceiptSchema.index(
  { orbitOwner: 1, level: 1, sourceCycle: 1, sourcePosition: 1 }
);

const ActivationReceipt = mongoose.model('ActivationReceipt', activationReceiptSchema);
export default ActivationReceipt;