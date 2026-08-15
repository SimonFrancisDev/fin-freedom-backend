import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import env from '../src/config/env.js';

const identities = [
  { id: 'FFN-WP98HB', old: '0xc0545331e20587208d4b27b2a3e4920cc481133a', replacement: '0x1ea5513e017b4e25847e91abc84ac8686331f80b' },
  { id: 'FFN-RYMQK4', old: '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba', replacement: '0xfb8d46674f51882baaa2c9606122484434ff2dc2' },
];
const fieldPaths = [
  'walletAddress', 'wallet', 'address', 'user', 'referrer', 'receiver', 'recipient', 'fromUser',
  'sourceUser', 'affectedUser', 'actualReceiver', 'orbitOwner', 'recycleReceiver', 'founderWallet',
  'occupant', 'positions.occupant', 'positions.indexedReceipts.receiver', 'positions.indexedReceipts.fromUser',
  'positions.indexedReceipts.orbitOwner', 'positions.indexedEvents.orbitOwner', 'positions.indexedEvents.user',
  'positions.ruleView.spillover1Recipient', 'positions.ruleView.spillover2Recipient',
];

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, maxPoolSize: 1, serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000, readPreference: 'secondaryPreferred',
  });
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const impact = [];
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = db.collection(name);
    for (const identity of identities) {
      const oldFields = {};
      const replacementFields = {};
      for (const field of fieldPaths) {
        const [oldCount, replacementCount] = await Promise.all([
          collection.countDocuments({ [field]: identity.old }, { maxTimeMS: 30000 }),
          collection.countDocuments({ [field]: identity.replacement }, { maxTimeMS: 30000 }),
        ]);
        if (oldCount) oldFields[field] = oldCount;
        if (replacementCount) replacementFields[field] = replacementCount;
      }
      if (Object.keys(oldFields).length || Object.keys(replacementFields).length) {
        impact.push({ collection: name, id: identity.id, oldFields, replacementFields });
      }
    }
  }
  const result = {
    generatedAt: new Date().toISOString(), database: db.databaseName,
    source: 'production MongoDB secondary; read-only impact inventory', identities,
    scannedCollections: collections.length, scannedFieldPaths: fieldPaths.length, impact,
  };
  const output = path.resolve('../staging-environment/smart-contract/migration-audits/wallet-replacement-database-impact.json');
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output, database: db.databaseName, scannedCollections: collections.length, impactedRows: impact.length }, null, 2));
} finally {
  await mongoose.disconnect();
}
