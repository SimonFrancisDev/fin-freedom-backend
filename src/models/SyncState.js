import mongoose from 'mongoose';

const syncStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    lastProcessedBlock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'error'],
      default: 'idle',
      index: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const SyncState = mongoose.model('SyncState', syncStateSchema);

export default SyncState;