import { UserProfile } from '../../models/index.js';

export const processUserEvent = async (event) => {
  const args = event.args;

  if (event.eventName === 'LevelActivated') {
    return handleLevelActivated(args, event);
  }

  if (event.eventName === 'FounderRepActivated') {
    return handleFounderRep(args);
  }
};

const handleLevelActivated = async (args, event) => {
  const user = args.user?.toLowerCase();

  await UserProfile.findOneAndUpdate(
    { address: user },
    {
      $set: {
        isParticipant: true,
        lastSeenBlock: event.blockNumber
      },
      $addToSet: {
        activeLevels: Number(args.level)
      },
      $max: {
        highestKnownActiveLevel: Number(args.level)
      }
    },
    { upsert: true, new: true }
  );
};

const handleFounderRep = async (args) => {
  const user = args.user?.toLowerCase();

  await UserProfile.findOneAndUpdate(
    { address: user },
    {
      isFounderRep: true,
      founderRepLevelsActivated: Number(args.totalActivated)
    },
    { upsert: true }
  );
};