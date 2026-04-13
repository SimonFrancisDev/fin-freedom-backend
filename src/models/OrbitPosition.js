import mongoose from 'mongoose';

const orbitPositionSchema = new mongoose.Schema(
  {
    orbitOwner: {
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
    cycleNumber: {
      type: Number,
      required: true,
      default: 1,
      index: true
    },
    position: {
      type: Number,
      required: true,
      index: true
    },
    line: {
      type: Number,
      required: true,
      index: true
    },
    occupant: {
      type: String,
      default: null,
      lowercase: true,
      index: true
    },
    referrer: {
      type: String,
      default: null,
      lowercase: true
    },
    amount: {
      type: String,
      default: '0'
    },
    timestamp: {
      type: Number,
      default: 0,
      index: true
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true
    },
    isHistorical: {
      type: Boolean,
      default: false,
      index: true
    },
    activationId: {
      type: Number,
      default: 0,
      index: true
    },
    activationCycleNumber: {
      type: Number,
      default: 0
    },
    isMirrorActivation: {
      type: Boolean,
      default: false,
      index: true
    },
    parentPosition: {
      type: Number,
      default: null
    },
    truthLabel: {
      type: String,
      default: 'NO_RECEIPT',
      index: true
    },
    linePaymentNumber: {
      type: Number,
      default: 0
    },
    autoUpgradeEnabled: {
      type: Boolean,
      default: false
    },
    isFounderNoReferrerPath: {
      type: Boolean,
      default: false
    },
    payoutSummary: {
      count: { type: Number, default: 0 },
      gross: { type: String, default: '0' },
      escrow: { type: String, default: '0' },
      liquid: { type: String, default: '0' },
      founderPathGross: { type: String, default: '0' },
      directOwnerGross: { type: String, default: '0' },
      routedSpilloverGross: { type: String, default: '0' },
      recycleGross: { type: String, default: '0' }
    },
    viewerBreakdownCached: {
      type: Boolean,
      default: false
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

orbitPositionSchema.index(
  { orbitOwner: 1, level: 1, cycleNumber: 1, position: 1 },
  { unique: true }
);

orbitPositionSchema.index(
  { orbitOwner: 1, level: 1, cycleNumber: 1 }
);

orbitPositionSchema.index(
  { occupant: 1, level: 1 }
);

orbitPositionSchema.index(
  { activationId: 1 }
);

const OrbitPosition = mongoose.model('OrbitPosition', orbitPositionSchema);
export default OrbitPosition;