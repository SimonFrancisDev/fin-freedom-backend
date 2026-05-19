import mongoose from 'mongoose';

const indexedFinancialEventSchema = new mongoose.Schema(
  {
    chainId: { type: Number, required: true, index: true },
    contractAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    eventName: { type: String, required: true, index: true, trim: true },
    txHash: { type: String, required: true, lowercase: true, trim: true, index: true },
    logIndex: { type: Number, required: true, min: 0 },
    blockNumber: { type: Number, required: true, index: true, min: 0 },
    blockHash: { type: String, default: '', lowercase: true, trim: true },

    activationId: { type: String, default: '0', index: true },
    user: { type: String, default: '', lowercase: true, trim: true, index: true },
    sourceUser: { type: String, default: '', lowercase: true, trim: true, index: true },
    affectedUser: { type: String, default: '', lowercase: true, trim: true, index: true },
    actualReceiver: { type: String, default: '', lowercase: true, trim: true, index: true },
    orbitOwner: { type: String, default: '', lowercase: true, trim: true, index: true },
    recycleReceiver: { type: String, default: '', lowercase: true, trim: true, index: true },
    founderWallet: { type: String, default: '', lowercase: true, trim: true, index: true },

    level: { type: Number, default: 0, index: true, min: 0 },
    fromLevel: { type: Number, default: 0, index: true, min: 0 },
    toLevel: { type: Number, default: 0, index: true, min: 0 },
    orbitType: { type: Number, default: 0, index: true },
    sourcePosition: { type: Number, default: 0 },
    sourceCycle: { type: Number, default: 0 },
    mirrorPosition: { type: Number, default: 0 },
    mirrorCycle: { type: Number, default: 0 },
    receiptType: { type: Number, default: 0, index: true },

    expectedAmount: { type: String, default: '0' },
    actualAmount: { type: String, default: '0' },
    systemChargeTotal: { type: String, default: '0' },
    nftPoolAmount: { type: String, default: '0' },
    operationsAmount: { type: String, default: '0' },
    founderAmount: { type: String, default: '0' },
    recycleGross: { type: String, default: '0' },
    recycleLiquidPaid: { type: String, default: '0' },
    recycleEscrowLocked: { type: String, default: '0' },
    requiredAmount: { type: String, default: '0' },
    usedAmount: { type: String, default: '0' },
    escrowBefore: { type: String, default: '0' },
    escrowAfter: { type: String, default: '0' },
    tokenAmount: { type: String, default: '0' },

    routedRole: { type: String, default: '' },
    reasonCode: { type: String, default: '', index: true },
    actionCode: { type: String, default: '', index: true },
    rewardType: { type: String, default: '', index: true },
    eligible: { type: Boolean, default: null },
    triggeredOrbitReset: { type: Boolean, default: false },

    timestamp: { type: Date, required: true, index: true },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

indexedFinancialEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
indexedFinancialEventSchema.index({ eventName: 1, timestamp: -1 });
indexedFinancialEventSchema.index({ activationId: 1, eventName: 1, timestamp: -1 });

export default mongoose.model('IndexedFinancialEvent', indexedFinancialEventSchema);
