import mongoose from 'mongoose';

const rawEventSchema = new mongoose.Schema(
  {
    chainId: {
      type: Number,
      required: true,
      index: true
    },
    contractName: {
      type: String,
      required: true,
      index: true
    },
    contractAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    eventName: {
      type: String,
      required: true,
      index: true
    },
    blockNumber: {
      type: Number,
      required: true,
      index: true
    },
    blockHash: {
      type: String,
      required: true,
      index: true
    },
    transactionHash: {
      type: String,
      required: true,
      index: true
    },
    transactionIndex: {
      type: Number,
      required: true
    },
    logIndex: {
      type: Number,
      required: true
    },
    removed: {
      type: Boolean,
      default: false,
      index: true
    },
    args: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    parsedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

rawEventSchema.index(
  { transactionHash: 1, logIndex: 1 },
  { unique: true }
);

rawEventSchema.index(
  { contractAddress: 1, eventName: 1, blockNumber: 1 }
);

const RawEvent = mongoose.model('RawEvent', rawEventSchema);
export default RawEvent;