import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';

const reportPath = path.resolve(
  process.env.PRESTATE_REPORT ||
  '../staging-environment/smart-contract/migration-audits/wallet-replacement-orbit-prestate-latest.json',
);
const outputPath = path.resolve('../staging-environment/smart-contract/migration-audits/wallet-replacement-orbit-window-verification.json');

try {
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const owners = [...new Set(report.references.map((row) => row.owner.toLowerCase()))];
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false,
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000,
    readPreference: 'secondaryPreferred',
  });
  const events = await IndexedOrbitEvent.find({
    chainId: 137,
    blockNumber: { $gte: report.snapshotStartBlock, $lte: report.snapshotEndBlock },
    $or: [
      { orbitOwner: { $in: owners } },
      { user: { $in: [
        '0xc0545331e20587208d4b27b2a3e4920cc481133a',
        '0x2f1e28756a42a3680b5ad42c58a0c3887c9e60ba',
      ] } },
    ],
  }).sort({ blockNumber: 1, logIndex: 1 }).lean();
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'production MongoDB index used only to detect activity during chain-read window',
    snapshotStartBlock: report.snapshotStartBlock,
    snapshotEndBlock: report.snapshotEndBlock,
    affectedOwnerCount: owners.length,
    eventCount: events.length,
    consistent: events.length === 0,
    events,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, eventCount: events.length, consistent: result.consistent }, null, 2));
  if (!result.consistent) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
