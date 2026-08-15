import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import env from '../src/config/env.js';

const MIGRATION_ID = 'wallet-replacement-wp98hb-rymqk4-v1';
const EXECUTE = String(process.env.EXECUTE || '').toLowerCase() === 'true';
const identities = [
  { shortCode: 'FFN-WP98HB', old: '0xc0545331e20587208d4b27b2a3e4920cc481133a', replacement: '0x1ea5513e017b4e25847e91abc84ac8686331f80b' },
  { shortCode: 'FFN-RYMQK4', old: '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba', replacement: '0xfb8d46674f51882baaa2c9606122484434ff2dc2' },
];
const oldToNew = new Map(identities.map((row) => [row.old, row.replacement]));
const fieldPaths = [
  'walletAddress', 'wallet', 'address', 'user', 'referrer', 'receiver', 'recipient', 'fromUser',
  'sourceUser', 'affectedUser', 'actualReceiver', 'orbitOwner', 'recycleReceiver', 'founderWallet',
  'occupant', 'positions.occupant', 'positions.indexedReceipts.receiver', 'positions.indexedReceipts.fromUser',
  'positions.indexedReceipts.orbitOwner', 'positions.indexedEvents.orbitOwner', 'positions.indexedEvents.user',
  'positions.ruleView.spillover1Recipient', 'positions.ruleView.spillover2Recipient',
];
const currentSnapshotCollections = new Set(['orbitlevelsnapshots', 'orbitpositionsnapshots']);
const excludedCollections = new Set(['walletreplacementbackups', 'walletidentityaliases']);

function canonicalize(value, key = '') {
  if (key === 'raw') return value;
  if (typeof value === 'string') return oldToNew.get(value.toLowerCase()) || value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, entry]) => [childKey, canonicalize(entry, childKey)]));
  }
  return value;
}

function impactFilter() {
  return { $or: fieldPaths.flatMap((field) => identities.map((identity) => ({ [field]: identity.old }))) };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, maxPoolSize: 2, serverSelectionTimeoutMS: 60000, socketTimeoutMS: 120000,
    readPreference: EXECUTE ? 'primary' : 'secondaryPreferred',
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== 'finfreedom') throw new Error(`Refusing unexpected database ${db.databaseName}`);

  for (const identity of identities) {
    const existing = await db.collection('referralcodes').findOne({ shortCode: identity.shortCode });
    if (!existing || existing.walletAddress !== identity.old || existing.isActive !== true) {
      throw new Error(`Referral precondition failed for ${identity.shortCode}`);
    }
    if (await db.collection('referralcodes').findOne({ walletAddress: identity.replacement })) {
      throw new Error(`Replacement referral collision for ${identity.shortCode}`);
    }
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const operations = [];
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludedCollections.has(name)) continue;
    const documents = await db.collection(name).find(impactFilter()).toArray();
    if (!documents.length) continue;
    operations.push({
      collection: name,
      action: currentSnapshotCollections.has(name) ? 'DELETE_FOR_CHAIN_REBUILD' : 'CANONICALIZE_NORMALIZED_FIELDS',
      count: documents.length,
      ids: documents.map((document) => String(document._id)).sort(),
    });
  }
  const planCore = { migrationId: MIGRATION_ID, database: db.databaseName, identities, operations };
  const planHash = `0x${crypto.createHash('sha256').update(JSON.stringify(stable(planCore))).digest('hex')}`;
  const report = { generatedAt: new Date().toISOString(), mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN', ...planCore, planHash };

  if (EXECUTE) {
    if (process.env.CONFIRM_MIGRATION_ID !== MIGRATION_ID || process.env.CONFIRM_PLAN_HASH !== planHash) {
      throw new Error('Execution confirmation does not match migration ID and dry-run plan hash');
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const backup = db.collection('walletreplacementbackups');
        if (await backup.findOne({ migrationId: MIGRATION_ID }, { session })) throw new Error('Migration backup already exists');
        for (const operation of operations) {
          const collection = db.collection(operation.collection);
          const documents = await collection.find(impactFilter(), { session }).toArray();
          if (documents.length !== operation.count) throw new Error(`Drift detected in ${operation.collection}`);
          if (documents.length) {
            await backup.insertMany(documents.map((document) => ({
              migrationId: MIGRATION_ID, collection: operation.collection,
              documentId: document._id, document, backedUpAt: new Date(),
            })), { session });
          }
          if (operation.action === 'DELETE_FOR_CHAIN_REBUILD') {
            await collection.deleteMany({ _id: { $in: documents.map((document) => document._id) } }, { session });
          } else {
            await collection.bulkWrite(documents.map((document) => ({
              replaceOne: {
                filter: { _id: document._id },
                replacement: canonicalize(document),
              },
            })), { session, ordered: true });
          }
        }
        await db.collection('walletidentityaliases').insertMany(identities.map((identity) => ({
          shortCode: identity.shortCode, oldWalletAddress: identity.old,
          replacementWalletAddress: identity.replacement, migrationId: MIGRATION_ID,
          chainId: 137, status: 'active', activatedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        })), { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }
  }

  const output = path.resolve(`../staging-environment/smart-contract/migration-audits/wallet-replacement-database-${EXECUTE ? 'execution' : 'dry-run'}.json`);
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, mode: report.mode, planHash, operations: operations.length, documents: operations.reduce((sum, row) => sum + row.count, 0) }, null, 2));
} finally {
  await mongoose.disconnect();
}
