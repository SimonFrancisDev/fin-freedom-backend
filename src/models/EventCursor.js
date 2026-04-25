import mongoose from 'mongoose';

const eventCursorSchema = new mongoose.Schema(
  {
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
    fromBlock: {
      type: Number,
      required: true,
      default: 0
    },
    toBlock: {
      type: Number,
      required: true,
      default: 0
    },
    lastSyncedBlock: {
      type: Number,
      required: true,
      default: 0,
      index: true
    },
    lastSyncedBlockHash: {
      type: String,
      default: null
    },
    syncStatus: {
      type: String,
      enum: ['idle', 'syncing', 'error'],
      default: 'idle',
      index: true
    },
    errorMessage: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

eventCursorSchema.index(
  { contractAddress: 1, eventName: 1 },
  { unique: true }
);

const EventCursor = mongoose.model('EventCursor', eventCursorSchema);
export default EventCursor;