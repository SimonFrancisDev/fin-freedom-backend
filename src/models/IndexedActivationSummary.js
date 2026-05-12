import mongoose from 'mongoose';

const indexedActivationSummarySchema = new mongoose.Schema(
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

    activationId: {
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

    level: {
      type: Number,
      required: true,
      index: true,
      min: 1,
      max: 10,
    },

    activationAmount: {
      type: String,
      required: true,
      default: '0',
    },

    systemCharge: {
      type: String,
      required: true,
      default: '0',
    },

    nftPoolAmount: {
      type: String,
      required: true,
      default: '0',
    },

    operationsAmount: {
      type: String,
      required: true,
      default: '0',
    },

    totalLiquidPaid: {
      type: String,
      required: true,
      default: '0',
    },

    totalEscrowLocked: {
      type: String,
      required: true,
      default: '0',
    },

    totalRecycleAllocated: {
      type: String,
      required: true,
      default: '0',
    },

    isAutoUpgrade: {
      type: Boolean,
      default: false,
      index: true,
    },

    isFounderRepFreeActivation: {
      type: Boolean,
      default: false,
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
    versionKey: false,
  }
);

indexedActivationSummarySchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedActivationSummarySchema.index({ user: 1, level: 1, timestamp: -1 });
indexedActivationSummarySchema.index({ activationId: 1, timestamp: -1 });

const IndexedActivationSummary = mongoose.model(
  'IndexedActivationSummary',
  indexedActivationSummarySchema
);

export default IndexedActivationSummary;