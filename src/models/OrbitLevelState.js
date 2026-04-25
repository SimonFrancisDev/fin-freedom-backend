import mongoose from 'mongoose';

const orbitLevelStateSchema = new mongoose.Schema(
  {
    userAddress: {
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
    orbitType: {
      type: String,
      required: true,
      enum: ['P4', 'P12', 'P39'],
      index: true
    },
    orbitOwner: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    currentPosition: {
      type: Number,
      default: 1
    },
    escrowBalance: {
      type: String,
      default: '0'
    },
    autoUpgradeCompleted: {
      type: Boolean,
      default: false,
      index: true
    },
    positionsInLine1: {
      type: Number,
      default: 0
    },
    positionsInLine2: {
      type: Number,
      default: 0
    },
    positionsInLine3: {
      type: Number,
      default: 0
    },
    totalCycles: {
      type: Number,
      default: 0,
      index: true
    },
    totalEarned: {
      type: String,
      default: '0'
    },
    linePaymentCounts: {
      line1: { type: Number, default: 0 },
      line2: { type: Number, default: 0 },
      line3: { type: Number, default: 0 }
    },
    lockedAmountForNextLevel: {
      type: String,
      default: '0'
    },
    isLevelActive: {
      type: Boolean,
      default: false,
      index: true
    },
    lastSyncedBlock: {
      type: Number,
      default: 0,
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

orbitLevelStateSchema.index(
  { userAddress: 1, level: 1 },
  { unique: true }
);

orbitLevelStateSchema.index(
  { orbitOwner: 1, level: 1 }
);

const OrbitLevelState = mongoose.model('OrbitLevelState', orbitLevelStateSchema);
export default OrbitLevelState;