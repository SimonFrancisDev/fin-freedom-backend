import mongoose from 'mongoose';

const indexerGapSchema = new mongoose.Schema(
  {
    gapKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    targetKey: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    fromBlock: {
      type: Number,
      required: true,
      min: 0,
    },
    toBlock: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['open', 'replaying', 'resolved', 'failed'],
      default: 'open',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstDetectedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: '',
    },
    ownerId: {
      type: String,
      default: '',
      trim: true,
    },
    processRole: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

indexerGapSchema.index({ status: 1, targetKey: 1, firstDetectedAt: 1 });
indexerGapSchema.index({ targetKey: 1, fromBlock: 1, toBlock: 1 });

const IndexerGap = mongoose.model('IndexerGap', indexerGapSchema);

export default IndexerGap;
