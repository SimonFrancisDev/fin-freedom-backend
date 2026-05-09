import mongoose from 'mongoose'

const ReferralAttributionSchema = new mongoose.Schema(
  {
    visitorId: {
      type: String,
      index: true,
      sparse: true,
      trim: true,
    },

    walletAddress: {
      type: String,
      lowercase: true,
      index: true,
      sparse: true,
      trim: true,
    },

    referrerCode: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    referrerWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    source: {
      type: String,
      default: 'referral_link',
    //   enum: ['referral_link', 'manual_input', 'system', 'restored'],
    enum: ['referral_link', 'manual_input', 'system', 'restored', 'registration'],
    },

    lockedAt: {
      type: Date,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    consumedAt: {
    type: Date,
    index: true,
    },

    consumedByWalletAddress: {
    type: String,
    lowercase: true,
    trim: true,
    index: true,
    },
  },
  {
    timestamps: true,
  }
)

ReferralAttributionSchema.index({ visitorId: 1, expiresAt: 1 })
ReferralAttributionSchema.index({ walletAddress: 1, expiresAt: 1 })
ReferralAttributionSchema.index({ visitorId: 1, consumedAt: 1, expiresAt: 1 })

export default mongoose.model('ReferralAttribution', ReferralAttributionSchema)