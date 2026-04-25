import mongoose from 'mongoose';

const SupportFaqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  answer: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Getting Started', 'Levels & Activation', 'Orbits System', 'Referrals & Commissions', 'Technical Issues', 'Account & Security']
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

export default mongoose.model('SupportFaq', SupportFaqSchema);