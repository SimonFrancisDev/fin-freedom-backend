import mongoose from 'mongoose';
import env from '../src/config/env.js';

const MIGRATION_ID = 'wallet-replacement-wp98hb-rymqk4-v1';
const EXECUTE = String(process.env.EXECUTE || '').toLowerCase() === 'true';

if (!EXECUTE || process.env.CONFIRM_ROLLBACK_MIGRATION_ID !== MIGRATION_ID) {
  throw new Error(`Rollback disabled. Set EXECUTE=true and CONFIRM_ROLLBACK_MIGRATION_ID=${MIGRATION_ID}`);
}

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000, readPreference: 'primary',
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== 'finfreedom') throw new Error(`Refusing unexpected database ${db.databaseName}`);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const backups = await db.collection('walletreplacementbackups')
        .find({ migrationId: MIGRATION_ID }, { session }).toArray();
      if (!backups.length) throw new Error(`No backup found for ${MIGRATION_ID}`);

      for (const backup of backups) {
        await db.collection(backup.collection).replaceOne(
          { _id: backup.documentId }, backup.document, { upsert: true, session },
        );
      }
      await db.collection('walletidentityaliases').deleteMany({ migrationId: MIGRATION_ID }, { session });
      await db.collection('walletreplacementrollbacks').insertOne({
        migrationId: MIGRATION_ID, restoredDocuments: backups.length,
        rolledBackAt: new Date(), createdAt: new Date(),
      }, { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
  console.log(JSON.stringify({ migrationId: MIGRATION_ID, status: 'ROLLED_BACK' }, null, 2));
} finally {
  await mongoose.disconnect();
}
