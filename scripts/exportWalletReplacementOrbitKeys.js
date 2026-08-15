import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';

const CHAIN_ID = 137;
const OLD_WALLETS = [
  '0xc0545331e20587208d4b27b2a3e4920cc481133a',
  '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba',
];

const outputPath = path.resolve(
  '../staging-environment/smart-contract/migration-audits/wallet-replacement-orbit-index-keys.json'
);

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false,
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000,
    readPreference: 'secondaryPreferred',
  });

  const rows = await IndexedOrbitEvent.aggregate([
    {
      $match: {
        chainId: CHAIN_ID,
        eventName: 'PositionFilled',
      },
    },
    {
      $group: {
        _id: {
          orbitType: '$orbitType',
          orbitOwner: '$orbitOwner',
          level: '$level',
        },
        firstBlock: { $min: '$blockNumber' },
        lastBlock: { $max: '$blockNumber' },
        eventCount: { $sum: 1 },
      },
    },
    { $sort: { '_id.orbitType': 1, '_id.orbitOwner': 1, '_id.level': 1 } },
  ]).allowDiskUse(true);

  const keys = rows.map(({ _id, firstBlock, lastBlock, eventCount }) => ({
    orbitType: _id.orbitType,
    orbitOwner: String(_id.orbitOwner).toLowerCase(),
    level: Number(_id.level),
    firstBlock,
    lastBlock,
    eventCount,
  }));

  const oldWalletReferences = await IndexedOrbitEvent.find({
    chainId: CHAIN_ID,
    eventName: 'PositionFilled',
    $or: [
      { orbitOwner: { $in: OLD_WALLETS } },
      { user: { $in: OLD_WALLETS } },
    ],
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();

  const result = {
    generatedAt: new Date().toISOString(),
    source: 'production MongoDB index; discovery only, not state truth',
    chainId: CHAIN_ID,
    keyCount: keys.length,
    keys,
    oldWalletReferenceCount: oldWalletReferences.length,
    oldWalletReferences,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, keyCount: keys.length, oldWalletReferenceCount: oldWalletReferences.length }, null, 2));
} finally {
  await mongoose.disconnect();
}
