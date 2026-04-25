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

const indexedReceiptSchema = new mongoose.Schema(
  {
    txHash: { type: String, default: '', lowercase: true, trim: true },
    logIndex: { type: Number, default: 0 },
    blockNumber: { type: Number, default: 0 },
    receiver: { type: String, default: '', lowercase: true, trim: true },
    activationId: { type: String, default: '0' },
    receiptType: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    fromUser: { type: String, default: '', lowercase: true, trim: true },
    orbitOwner: { type: String, default: '', lowercase: true, trim: true },
    sourcePosition: { type: Number, default: 0 },
    sourceCycle: { type: Number, default: 0 },
    mirroredPosition: { type: Number, default: 0 },
    mirroredCycle: { type: Number, default: 0 },
    routedRole: { type: Number, default: 0 },
    grossAmount: { type: String, default: '0' },
    escrowLocked: { type: String, default: '0' },
    liquidPaid: { type: String, default: '0' },
    timestamp: { type: Date, default: null },
    rawEventName: { type: String, default: '' },
  },
  { _id: false }
);

const indexedEventSchema = new mongoose.Schema(
  {
    txHash: { type: String, default: '', lowercase: true, trim: true },
    logIndex: { type: Number, default: 0 },
    blockNumber: { type: Number, default: 0 },
    eventName: { type: String, default: '' },
    orbitOwner: { type: String, default: '', lowercase: true, trim: true },
    user: { type: String, default: '', lowercase: true, trim: true },
    level: { type: Number, default: 0 },
    position: { type: Number, default: 0 },
    amount: { type: String, default: '0' },
    cycleNumber: { type: Number, default: 0 },
    line: { type: Number, default: 0 },
    linePaymentNumber: { type: Number, default: 0 },
    timestamp: { type: Date, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const cyclePositionSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1 },
    level: { type: Number, required: true, min: 1, max: 10 },
    cycleNumber: { type: Number, required: true, min: 1 },
    orbitType: { type: String, required: true, enum: ['P4', 'P12', 'P39'] },

    line: { type: Number, default: 1, min: 1 },
    parentPosition: { type: Number, default: null, min: 1 },

    occupant: { type: String, default: null, lowercase: true, trim: true },
    amount: { type: String, default: '0' },
    timestamp: { type: Number, default: 0, min: 0 },

    activationId: { type: Number, default: 0, min: 0 },
    activationCycleNumber: { type: Number, default: 0, min: 0 },
    isMirrorActivation: { type: Boolean, default: false },

    truthLabel: { type: String, default: 'NO_RECEIPT' },
    indexedEventCount: { type: Number, default: 0, min: 0 },
    indexedReceiptCount: { type: Number, default: 0, min: 0 },

    receiptTotals: { type: receiptTotalsSchema, default: () => ({}) },
    viewerReceiptBreakdown: { type: viewerReceiptBreakdownSchema, default: () => ({}) },

    indexedReceipts: { type: [indexedReceiptSchema], default: [] },
    indexedEvents: { type: [indexedEventSchema], default: [] },
    ruleView: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const metadataSchema = new mongoose.Schema(
  {
    snapshotVersion: { type: Number, default: 1, min: 1 },
    builtFromBlock: { type: Number, default: 0, min: 0 },
    builtAt: { type: Date, default: null },
    freshnessBlock: { type: Number, default: 0, min: 0 },
    completeness: {
      type: new mongoose.Schema(
        {
          positionsReady: { type: Boolean, default: false },
          historicalReady: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { _id: false }
);

const orbitCycleSnapshotSchema = new mongoose.Schema(
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
    cycleNumber: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },
    orbitType: {
      type: String,
      required: true,
      enum: ['P4', 'P12', 'P39'],
      index: true,
    },

    filledPositions: { type: Number, default: 0, min: 0 },
    totalPositions: { type: Number, required: true, min: 1 },

    positions: { type: [cyclePositionSchema], default: [] },

    metadata: { type: metadataSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

orbitCycleSnapshotSchema.index({ address: 1, level: 1, cycleNumber: 1 }, { unique: true });
orbitCycleSnapshotSchema.index({ address: 1, level: 1, updatedAt: -1 });
orbitCycleSnapshotSchema.index({ orbitType: 1, level: 1, cycleNumber: -1 });

const OrbitCycleSnapshot = mongoose.model('OrbitCycleSnapshot', orbitCycleSnapshotSchema);

export default OrbitCycleSnapshot;