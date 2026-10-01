import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  contractKey: { type: String, required: true, index: true },
  contractAddress: { type: String, required: true, lowercase: true, index: true },
  eventName: { type: String, required: true, index: true },
  txHash: { type: String, required: true, lowercase: true, index: true },
  logIndex: { type: Number, required: true },
  blockNumber: { type: Number, required: true, index: true },
  blockHash: { type: String, required: true, lowercase: true },
  timestamp: { type: Date, required: true, index: true },
  activationId: { type: String, default: '', lowercase: true, index: true },
  addresses: [{ type: String, lowercase: true }],
  args: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false });

schema.index(
  { chainId: 1, contractAddress: 1, txHash: 1, logIndex: 1 },
  { unique: true }
);
schema.index({ eventName: 1, blockNumber: -1, logIndex: -1 });
schema.index({ addresses: 1, blockNumber: -1, logIndex: -1 });

export default mongoose.model('FreedomPlusEvent', schema);
