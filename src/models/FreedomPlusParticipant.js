import mongoose from 'mongoose';

const levelSchema = new mongoose.Schema({
  level: { type: Number, required: true, min: 1, max: 7 },
  active: { type: Boolean, default: false },
  activationId: { type: String, default: '', lowercase: true },
  activatedAtBlock: { type: Number, default: 0 },
  activatedAt: { type: Date, default: null },
  genesis: { type: Boolean, default: false },
}, { _id: false });

const schema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  wallet: { type: String, required: true, lowercase: true, index: true },
  sponsor: { type: String, default: '', lowercase: true, index: true },
  participantNumber: { type: Number, default: 0, index: true },
  registered: { type: Boolean, default: false, index: true },
  registeredAtBlock: { type: Number, default: 0 },
  registeredAt: { type: Date, default: null },
  levels: { type: [levelSchema], default: [] },
}, { timestamps: true, versionKey: false });

schema.index({ chainId: 1, wallet: 1 }, { unique: true });
schema.index({ chainId: 1, participantNumber: 1 }, { unique: true, sparse: true });

export default mongoose.model('FreedomPlusParticipant', schema);
