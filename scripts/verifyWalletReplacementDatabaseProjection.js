import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import env from '../src/config/env.js';

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
const deletedCollections = new Set(['orbitlevelsnapshots', 'orbitpositionsnapshots']);
const excludedCollections = new Set(['walletreplacementbackups', 'walletidentityaliases']);

function impactFilter() {
  return { $or: fieldPaths.flatMap((field) => identities.map((identity) => ({ [field]: identity.old }))) };
}

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

function findOldReferences(value, pathParts = [], findings = []) {
  if (pathParts.at(-1) === 'raw') return findings;
  if (typeof value === 'string' && oldToNew.has(value.toLowerCase())) findings.push(pathParts.join('.'));
  else if (Array.isArray(value)) value.forEach((entry, index) => findOldReferences(entry, [...pathParts, String(index)], findings));
  else if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      Object.entries(value).forEach(([key, entry]) => findOldReferences(entry, [...pathParts, key], findings));
    }
  }
  return findings;
}

try {
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, maxPoolSize: 1, serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000, readPreference: 'secondaryPreferred',
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== 'finfreedom') throw new Error(`Refusing unexpected database ${db.databaseName}`);

  const failures = [];
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const projection = [];
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludedCollections.has(name)) continue;
    const documents = await db.collection(name).find(impactFilter()).toArray();
    if (!documents.length) continue;
    if (deletedCollections.has(name)) {
      projection.push({ collection: name, action: 'DELETE_FOR_CHAIN_REBUILD', count: documents.length });
      continue;
    }
    let remainingOldReferences = 0;
    for (const document of documents) {
      const projected = canonicalize(document);
      const references = findOldReferences(projected);
      remainingOldReferences += references.length;
      if (references.length) failures.push(`${name}/${document._id}: ${references.join(', ')}`);
    }
    projection.push({ collection: name, action: 'CANONICALIZE_NORMALIZED_FIELDS', count: documents.length, remainingOldReferences });
  }

  for (const identity of identities) {
    const source = await db.collection('referralcodes').findOne({ shortCode: identity.shortCode });
    if (!source || source.walletAddress !== identity.old || source.isActive !== true) failures.push(`${identity.shortCode}: source identity precondition failed`);
    if (await db.collection('referralcodes').findOne({ walletAddress: identity.replacement })) failures.push(`${identity.shortCode}: replacement wallet collision`);
    const projected = source ? canonicalize(source) : null;
    if (!projected || projected.shortCode !== identity.shortCode || projected.walletAddress !== identity.replacement) failures.push(`${identity.shortCode}: projected ID/wallet binding failed`);
  }

  const report = {
    generatedAt: new Date().toISOString(), database: db.databaseName,
    mode: 'READ_ONLY_PROJECTED_POST_STATE', identities, projection,
    verdict: failures.length ? 'FAIL' : 'PASS', failures,
  };
  const output = path.resolve('../staging-environment/smart-contract/migration-audits/wallet-replacement-database-projection.json');
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, verdict: report.verdict, operations: projection.length, documents: projection.reduce((sum, row) => sum + row.count, 0), failures: failures.length }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
