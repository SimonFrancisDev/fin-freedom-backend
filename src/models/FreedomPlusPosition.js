import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  orbitType: { type: String, enum: ['P39', 'P14', 'P12', 'P6', 'P4', 'P3'], required: true, index: true },
  orbitOwner: { type: String, required: true, lowercase: true, index: true },
  participant: { type: String, required: true, lowercase: true, index: true },
  structuralParent: { type: String, required: true, lowercase: true, index: true },
  level: { type: Number, required: true, min: 1, max: 7, index: true },
  cycle: { type: Number, required: true, min: 0 },
  position: { type: Number, required: true, min: 1 },
  ring: { type: Number, required: true, min: 1, max: 3 },
  kind: { type: Number, required: true, min: 0, max: 3, index: true },
  financial: { type: Boolean, required: true },
  amount: { type: String, required: true },
  activationId: { type: String, required: true, lowercase: true, index: true },
  placementId: { type: String, required: true, lowercase: true, index: true },
  txHash: { type: String, required: true, lowercase: true },
  blockNumber: { type: Number, required: true, index: true },
  timestamp: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

schema.index(
  { chainId: 1, orbitType: 1, orbitOwner: 1, level: 1, cycle: 1, position: 1 },
  { unique: true }
);
schema.index({ chainId: 1, placementId: 1 }, { unique: true });

export default mongoose.model('FreedomPlusPosition', schema);
