import mongoose from 'mongoose';

const indexedOrbitEventSchema = new mongoose.Schema(
  {
    chainId: {
      type: Number,
      required: true,
      index: true,
    },
    orbitType: {
      type: String,
      required: true,
      enum: ['P4', 'P12', 'P39'],
      index: true,
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

    orbitOwner: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
      index: true,
    },
    user: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
      index: true,
    },
    level: {
      type: Number,
      default: 0,
      index: true,
      min: 0,
    },
    position: {
      type: Number,
      default: 0,
      min: 0,
    },
    amount: {
      type: String,
      default: '0',
    },
    cycleNumber: {
      type: Number,
      default: 0,
      min: 0,
    },
    line: {
      type: Number,
      default: 0,
      min: 0,
    },
    linePaymentNumber: {
      type: Number,
      default: 0,
      min: 0,
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

indexedOrbitEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedOrbitEventSchema.index({ orbitOwner: 1, level: 1, eventName: 1, timestamp: -1 });
indexedOrbitEventSchema.index({ user: 1, level: 1, eventName: 1, timestamp: -1 });

const IndexedOrbitEvent = mongoose.model('IndexedOrbitEvent', indexedOrbitEventSchema);

export default IndexedOrbitEvent;