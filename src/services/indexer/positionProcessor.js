import { OrbitPosition } from '../../models/index.js';

export const processPositionEvent = async (event) => {
  const args = event.args;

  if (event.eventName === 'PositionFilled') {
    return handlePositionFilled(event, args);
  }

  if (event.eventName === 'OrbitReset') {
    return handleOrbitReset(event, args);
  }
};

const handlePositionFilled = async (event, args) => {
  const orbitOwner = args.orbitOwner?.toLowerCase();

  await OrbitPosition.findOneAndUpdate(
    {
      orbitOwner,
      level: Number(args.level),
      cycleNumber: 1, // temporary (we will fix in Step 11)
      position: Number(args.position)
    },
    {
      occupant: args.user?.toLowerCase(),
      amount: args.amount?.toString(),
      timestamp: Number(args.timestamp),
      isActive: true,
      lastSyncedBlock: event.blockNumber
    },
    { upsert: true, new: true }
  );
};

const handleOrbitReset = async (event, args) => {
  const orbitOwner = args.user?.toLowerCase();

  // mark previous positions as historical
  await OrbitPosition.updateMany(
    { orbitOwner, level: Number(args.level), isHistorical: false },
    { isHistorical: true }
  );
};