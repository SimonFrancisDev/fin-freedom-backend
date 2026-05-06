import mongoose from 'mongoose';


const indexedTokenEventSchema = new mongoose.Schema({
  chainId: Number,
  tokenSymbol: { type: String, enum: ['FGT', 'FGTr'] }, 
  eventName: { type: String, index: true },   // UtilityMinted, UtilityBurned, UtilityLocked
  txHash: { type: String, lowercase: true },
  logIndex: Number,
  blockNumber: { type: Number, index: true },
  userAddress: { type: String, lowercase: true, index: true },
  amount: String,
  reason: String,
  level: { type: Number, default: 0, index: true },
  timestamp: { type: Date, index: true },
}, { timestamps: true });

// Ensure we never save the same event twice
indexedTokenEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });

export default mongoose.model('IndexedTokenEvent', indexedTokenEventSchema);