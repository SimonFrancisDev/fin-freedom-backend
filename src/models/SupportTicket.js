import mongoose from 'mongoose';

const SupportTicketSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    lowercase: true
  },
  category: {
    type: String,
    required: true,
    enum: ['registration', 'levels', 'orbits', 'referrals', 'wallet', 'transaction', 'other']
  },
  subject: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  txHash: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'closed'],
    default: 'open'
  },
  adminNotes: {
    type: String,
    default: ''
  }
}, { timestamps: true });

export default mongoose.model('SupportTicket', SupportTicketSchema);