import mongoose from 'mongoose';

const userReceiptSummarySchema = new mongoose.Schema(
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
    receiptCount: {
      type: Number,
      default: 0
    },
    totals: {
      gross: { type: String, default: '0' },
      escrow: { type: String, default: '0' },
      liquid: { type: String, default: '0' },
      founderPathGross: { type: String, default: '0' },
      founderPathEscrow: { type: String, default: '0' },
      founderPathLiquid: { type: String, default: '0' },
      directOwnerGross: { type: String, default: '0' },
      directOwnerEscrow: { type: String, default: '0' },
      directOwnerLiquid: { type: String, default: '0' },
      routedSpilloverGross: { type: String, default: '0' },
      routedSpilloverEscrow: { type: String, default: '0' },
      routedSpilloverLiquid: { type: String, default: '0' },
      recycleGross: { type: String, default: '0' },
      recycleEscrow: { type: String, default: '0' },
      recycleLiquid: { type: String, default: '0' }
    },
    byActivationIds: {
      type: [Number],
      default: []
    },
    byFromUsers: {
      type: [String],
      default: []
    },
    lastReceiptBlock: {
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

userReceiptSummarySchema.index(
  { userAddress: 1, level: 1 },
  { unique: true }
);

const UserReceiptSummary = mongoose.model('UserReceiptSummary', userReceiptSummarySchema);
export default UserReceiptSummary;