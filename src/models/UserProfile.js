import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true
    },
    referrer: {
      type: String,
      default: null,
      lowercase: true,
      index: true
    },
    isRegistered: {
      type: Boolean,
      default: false,
      index: true
    },
    isParticipant: {
      type: Boolean,
      default: false,
      index: true
    },
    isId1Downline: {
      type: Boolean,
      default: false,
      index: true
    },
    isFounderRep: {
      type: Boolean,
      default: false,
      index: true
    },
    founderRepUsed: {
      type: Boolean,
      default: false
    },
    founderRepLevelsActivated: {
      type: Number,
      default: 0
    },
    founderRepAllLevelsCompleted: {
      type: Boolean,
      default: false
    },
    highestKnownActiveLevel: {
      type: Number,
      default: 0,
      index: true
    },
    activeLevels: {
      type: [Number],
      default: []
    },
    firstSeenBlock: {
      type: Number,
      default: null
    },
    lastSeenBlock: {
      type: Number,
      default: null,
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

const UserProfile = mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;