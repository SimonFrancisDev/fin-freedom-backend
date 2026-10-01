import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  category: {
    type: String,
    enum: [
      'system_charge', 'recycle_reserve', 'recycle', 'fpt', 'fptr',
      'token_lock', 'token_unlock', 'token_burn', 'nft_membership',
      'nft_eligibility', 'nft_period', 'nft_claim', 'cycle_close', 'founder_income',
    ],
    required: true,
    index: true,
  },
  wallet: { type: String, default: '', lowercase: true, index: true },
  level: { type: Number, default: 0, index: true },
  amount: { type: String, default: '0' },
  activationId: { type: String, default: '', lowercase: true, index: true },
  contractKey: { type: String, required: true },
  eventName: { type: String, required: true },
  txHash: { type: String, required: true, lowercase: true },
  logIndex: { type: Number, required: true },
  blockNumber: { type: Number, required: true, index: true },
  timestamp: { type: Date, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, txHash: 1, logIndex: 1 }, { unique: true });
schema.index({ chainId: 1, wallet: 1, category: 1, blockNumber: -1 });

export default mongoose.model('FreedomPlusLedgerEntry', schema);
