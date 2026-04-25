import mongoose from 'mongoose';

const receiptTotalsSchema = new mongoose.Schema(
  {
    count: { type: Number, default: 0, min: 0 },
    gross: { type: String, default: '0' },
    escrowLocked: { type: String, default: '0' },
    liquidPaid: { type: String, default: '0' },
    founderPathGross: { type: String, default: '0' },
    directOwnerGross: { type: String, default: '0' },
    routedSpilloverGross: { type: String, default: '0' },
    recycleGross: { type: String, default: '0' },
  },
  { _id: false }
);

const viewerReceiptBreakdownSchema = new mongoose.Schema(
  {
    count: { type: Number, default: 0, min: 0 },
    totalGross: { type: String, default: '0' },
    totalLiquid: { type: String, default: '0' },
    totalEscrow: { type: String, default: '0' },

    founderPathGross: { type: String, default: '0' },
    founderPathLiquid: { type: String, default: '0' },
    founderPathEscrow: { type: String, default: '0' },

    directOwnerGross: { type: String, default: '0' },
    directOwnerLiquid: { type: String, default: '0' },
    directOwnerEscrow: { type: String, default: '0' },

    routedSpilloverGross: { type: String, default: '0' },
    routedSpilloverLiquid: { type: String, default: '0' },
    routedSpilloverEscrow: { type: String, default: '0' },

    recycleGross: { type: String, default: '0' },
    recycleLiquid: { type: String, default: '0' },
    recycleEscrow: { type: String, default: '0' },
  },
  { _id: false }
);

const orbitPositionSnapshotSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1 },
    line: { type: Number, required: true, min: 1 },
    parentPosition: { type: Number, default: null, min: 1 },

    occupant: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },

    amount: { type: String, default: '0' },
    timestamp: { type: Number, default: 0, min: 0 },

    activationId: { type: Number, default: 0, min: 0 },
    activationCycleNumber: { type: Number, default: 0, min: 0 },
    isMirrorActivation: { type: Boolean, default: false },

    truthLabel: {
      type: String,
      default: 'NO_RECEIPT',
      trim: true,
    },

    indexedEventCount: { type: Number, default: 0, min: 0 },
    indexedReceiptCount: { type: Number, default: 0, min: 0 },

    receiptTotals: {
      type: receiptTotalsSchema,
      default: () => ({}),
    },

    viewerReceiptBreakdown: {
      type: viewerReceiptBreakdownSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const orbitSummarySchema = new mongoose.Schema(
  {
    currentPosition: { type: Number, default: 0, min: 0 },
    escrowBalance: { type: String, default: '0' },
    autoUpgradeCompleted: { type: Boolean, default: false },
    positionsInLine1: { type: Number, default: 0, min: 0 },
    positionsInLine2: { type: Number, default: 0, min: 0 },
    positionsInLine3: { type: Number, default: 0, min: 0 },
    totalCycles: { type: Number, default: 0, min: 0 },
    totalEarned: { type: String, default: '0' },
  },
  { _id: false }
);

const linePaymentCountsSchema = new mongoose.Schema(
  {
    line1: { type: Number, default: 0, min: 0 },
    line2: { type: Number, default: 0, min: 0 },
    line3: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const completenessSchema = new mongoose.Schema(
  {
    positionsReady: { type: Boolean, default: false },
    summaryReady: { type: Boolean, default: false },
    activationFlagsReady: { type: Boolean, default: false },
  },
  { _id: false }
);

const metadataSchema = new mongoose.Schema(
  {
    snapshotVersion: { type: Number, default: 1, min: 1 },
    builtFromBlock: { type: Number, default: 0, min: 0 },
    builtAt: { type: Date, default: null },
    enrichedAt: { type: Date, default: null },
    freshnessBlock: { type: Number, default: 0, min: 0 },

    completeness: {
      type: completenessSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const orbitLevelSnapshotSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    level: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      index: true,
    },

    orbitType: {
      type: String,
      required: true,
      enum: ['P4', 'P12', 'P39'],
      index: true,
    },

    isLevelActive: {
      type: Boolean,
      default: false,
    },

    orbitSummary: {
      type: orbitSummarySchema,
      default: () => ({}),
    },

    linePaymentCounts: {
      type: linePaymentCountsSchema,
      default: () => ({}),
    },

    lockedForNextLevel: {
      type: String,
      default: '0',
    },

    positions: {
      type: [orbitPositionSnapshotSchema],
      default: [],
    },

    metadata: {
      type: metadataSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

orbitLevelSnapshotSchema.index({ address: 1, level: 1 }, { unique: true });
orbitLevelSnapshotSchema.index({ address: 1, updatedAt: -1 });
orbitLevelSnapshotSchema.index({ orbitType: 1, level: 1, updatedAt: -1 });
orbitLevelSnapshotSchema.index({ 'metadata.freshnessBlock': -1 });

const OrbitLevelSnapshot = mongoose.model(
  'OrbitLevelSnapshot',
  orbitLevelSnapshotSchema
);

export default OrbitLevelSnapshot;