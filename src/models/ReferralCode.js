import mongoose from 'mongoose';

const ReferralCodeSchema = new mongoose.Schema({
  shortCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
    minlength: 8,
    maxlength: 12,
  },
  walletAddress: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Compound index for fast lookups
ReferralCodeSchema.index({ shortCode: 1 });
ReferralCodeSchema.index({ walletAddress: 1 }, { unique: true });

const ReferralCode = mongoose.model('ReferralCode', ReferralCodeSchema);

export default ReferralCode;