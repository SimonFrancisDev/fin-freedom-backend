import mongoose from 'mongoose';

const officialVideoSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'official', unique: true, immutable: true },
    youtubeId: { type: String, required: true, trim: true, minlength: 11, maxlength: 11 },
    youtubeUrl: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: '', trim: true, maxlength: 1200 },
    isPublished: { type: Boolean, default: false, index: true },
    updatedBy: { type: String, default: 'admin', trim: true, maxlength: 80 },
  },
  { timestamps: true, versionKey: false }
);

export default mongoose.model('OfficialVideo', officialVideoSchema);