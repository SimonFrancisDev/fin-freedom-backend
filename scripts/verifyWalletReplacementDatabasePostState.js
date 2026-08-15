import mongoose from 'mongoose';
import env from '../src/config/env.js';

const migrationId = 'wallet-replacement-wp98hb-rymqk4-v1';
const identities = [
  { shortCode: 'FFN-WP98HB', old: '0xc0545331e20587208d4b27b2a3e4920cc481133a', replacement: '0x1ea5513e017b4e25847e91abc84ac8686331f80b' },
  { shortCode: 'FFN-RYMQK4', old: '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba', replacement: '0xfb8d46674f51882baaa2c9606122484434ff2dc2' },
];
const fieldPaths = [
  'walletAddress', 'wallet', 'address', 'user', 'referrer', 'receiver', 'recipient', 'fromUser',
  'sourceUser', 'affectedUser', 'actualReceiver', 'orbitOwner', 'recycleReceiver', 'founderWallet',
  'occupant', 'positions.occupant', 'positions.indexedReceipts.receiver', 'positions.indexedReceipts.fromUser',
  'positions.indexedReceipts.orbitOwner', 'positions.indexedEvents.orbitOwner', 'positions.indexedEvents.user',
  'positions.ruleView.spillover1Recipient', 'positions.ruleView.spillover2Recipient',
];
const excluded = new Set(['walletreplacementbackups', 'walletidentityaliases']);

function oldReferenceFilter() {
  return { $or: fieldPaths.flatMap((field) => identities.map((identity) => ({ [field]: identity.old }))) };
}

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, maxPoolSize: 1, serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000, readPreference: 'primary',
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== 'finfreedom') throw new Error(`Refusing unexpected database ${db.databaseName}`);

  const failures = [];
  const referralBindings = [];
  for (const identity of identities) {
    const byCode = await db.collection('referralcodes').find({ shortCode: identity.shortCode }).toArray();
    const byReplacement = await db.collection('referralcodes').find({ walletAddress: identity.replacement }).toArray();
    const byOld = await db.collection('referralcodes').find({ walletAddress: identity.old }).toArray();
    const pass = byCode.length === 1 && byReplacement.length === 1 && byOld.length === 0 &&
      byCode[0]?.walletAddress === identity.replacement && byCode[0]?.isActive === true;
    referralBindings.push({ shortCode: identity.shortCode, byCode: byCode.length, byReplacement: byReplacement.length, byOld: byOld.length, walletAddress: byCode[0]?.walletAddress, pass });
    if (!pass) failures.push(`${identity.shortCode}: referral binding mismatch`);
  }

  const aliases = await db.collection('walletidentityaliases').find({ migrationId }).toArray();
  if (aliases.length !== 2) failures.push(`Expected 2 aliases, found ${aliases.length}`);
  for (const identity of identities) {
    if (!aliases.some((row) => row.shortCode === identity.shortCode && row.oldWalletAddress === identity.old && row.replacementWalletAddress === identity.replacement && row.status === 'active')) {
      failures.push(`${identity.shortCode}: active identity alias missing`);
    }
  }

  const backupCount = await db.collection('walletreplacementbackups').countDocuments({ migrationId });
  if (backupCount !== 597) failures.push(`Expected 597 backup documents, found ${backupCount}`);

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const remainingOldReferences = [];
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(name)) continue;
    const count = await db.collection(name).countDocuments(oldReferenceFilter(), { maxTimeMS: 60000 });
    if (count) remainingOldReferences.push({ collection: name, count });
  }
  if (remainingOldReferences.length) failures.push(`Old normalized references remain in ${remainingOldReferences.length} collections`);

  const result = {
    generatedAt: new Date().toISOString(), database: db.databaseName, migrationId,
    verdict: failures.length ? 'FAIL' : 'PASS', failures, referralBindings,
    aliases: aliases.length, backupCount, scannedCollections: collections.length, remainingOldReferences,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
