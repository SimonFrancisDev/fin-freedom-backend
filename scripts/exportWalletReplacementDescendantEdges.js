import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';

const BLOCK = 91313968;
const ROOTS = [
  '0xc0545331e20587208d4b27b2a3e4920cc481133a',
  '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba',
];
const lower = (value) => String(value || '').toLowerCase();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: 'finfreedom',
    autoIndex: false,
    serverSelectionTimeoutMS: 60000,
  });
  const registrations = await IndexedRegistrationEvent.find({
    chainId: 137,
    eventName: 'Registered',
    blockNumber: { $lte: BLOCK },
  }).sort({ blockNumber: 1, logIndex: 1 }).lean();
  const parentOf = new Map();
  const children = new Map();
  for (const row of registrations) {
    const child = lower(row.user);
    const parent = lower(row.referrer);
    parentOf.set(child, parent);
    const entries = children.get(parent) || [];
    entries.push(child);
    children.set(parent, entries);
  }

  const descendants = new Set();
  const frontier = [...ROOTS];
  while (frontier.length) {
    const parent = frontier.shift();
    for (const child of children.get(parent) || []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      frontier.push(child);
    }
  }
  const edges = [...descendants].sort().map((child) => ({ child, parent: parentOf.get(child) }));
  const report = { generatedAt: new Date().toISOString(), frozenBlock: BLOCK, roots: ROOTS, edgeCount: edges.length, edges };
  await mkdir('migration-audits', { recursive: true });
  const output = 'migration-audits/wallet-replacement-descendant-edges-91313968.json';
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, edgeCount: edges.length }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
