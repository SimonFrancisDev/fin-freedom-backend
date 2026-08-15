import 'dotenv/config';
import mongoose from 'mongoose';
import SyncState from '../src/models/SyncState.js';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';
import IndexedEscrowEvent from '../src/models/IndexedEscrowEvent.js';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import { JsonRpcProvider } from 'ethers';

const chainId = Number(process.env.CHAIN_ID || 137);
const skipTailLogs = String(process.env.AUDIT_SKIP_TAIL_LOGS || '').toLowerCase() === 'true';
const tailChunkSize = Math.max(1, Number(process.env.AUDIT_TAIL_CHUNK_SIZE || 100));
const units = (value) => {
  const text = String(value ?? '0');
  return text.includes('.') ? Number(text) : Number(BigInt(text)) / 1e6;
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  let liveHead = 0;
  let liveRpc = '';
  let liveRpcError = '';
  let liveProvider = null;
  for (const [name, url] of [['RPC_URL_1', process.env.RPC_URL_1], ['RPC_URL_2', process.env.RPC_URL_2]]) {
    if (!url) continue;
    try {
      const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true });
      liveHead = await provider.getBlockNumber();
      liveRpc = name;
      liveProvider = provider;
      break;
    } catch (error) {
      liveRpcError = `${name}: ${error.shortMessage || error.message}`;
    }
  }

  const [
    syncStates,
    registeredRows,
    activationRows,
    receipts,
    financialEvents,
    escrowEvents,
    snapshots,
  ] = await Promise.all([
    SyncState.find({}).sort({ key: 1 }).lean(),
    IndexedRegistrationEvent.find({ chainId, eventName: 'Registered' })
      .select('user referrer blockNumber txHash timestamp').sort({ blockNumber: 1 }).lean(),
    IndexedRegistrationEvent.find({ chainId, eventName: 'LevelActivated' })
      .select('user level blockNumber txHash timestamp').sort({ blockNumber: 1 }).lean(),
    IndexedReceipt.find({ chainId }).lean(),
    IndexedFinancialEvent.find({ chainId }).lean(),
    IndexedEscrowEvent.find({ chainId }).lean(),
    OrbitLevelSnapshot.find({}).lean(),
  ]);

  const registered = new Map();
  for (const row of registeredRows) registered.set(row.user, row);
  const activeLevels = new Map();
  for (const row of activationRows) {
    if (!activeLevels.has(row.user)) activeLevels.set(row.user, new Set());
    activeLevels.get(row.user).add(row.level);
  }

  const boundaries = { P4: 4, P12: 12, P39: 39 };
  const boundarySensitive = [];
  const partialEscrow = [];
  const cycled = [];
  const incompleteSnapshots = [];

  for (const snapshot of snapshots) {
    const current = Number(snapshot.orbitSummary?.currentPosition || 0);
    const totalCycles = Number(snapshot.orbitSummary?.totalCycles || 0);
    const locked = units(snapshot.lockedForNextLevel || snapshot.orbitSummary?.escrowBalance || '0');
    const boundary = boundaries[snapshot.orbitType];
    if (snapshot.isLevelActive && boundary && current >= boundary - 2) {
      boundarySensitive.push({
        address: snapshot.address,
        level: snapshot.level,
        orbitType: snapshot.orbitType,
        currentPosition: current,
        totalCycles,
        lockedForNextLevel: locked,
        freshnessBlock: snapshot.metadata?.freshnessBlock || 0,
      });
    }
    if (locked > 0) {
      partialEscrow.push({
        address: snapshot.address,
        level: snapshot.level,
        orbitType: snapshot.orbitType,
        currentPosition: current,
        lockedForNextLevel: locked,
        autoUpgradeCompleted: Boolean(snapshot.orbitSummary?.autoUpgradeCompleted),
        freshnessBlock: snapshot.metadata?.freshnessBlock || 0,
      });
    }
    if (totalCycles > 0) {
      cycled.push({
        address: snapshot.address,
        level: snapshot.level,
        orbitType: snapshot.orbitType,
        currentPosition: current,
        totalCycles,
      });
    }
    const completeness = snapshot.metadata?.completeness || {};
    if (!completeness.positionsReady || !completeness.summaryReady || !completeness.activationFlagsReady) {
      incompleteSnapshots.push({
        address: snapshot.address,
        level: snapshot.level,
        orbitType: snapshot.orbitType,
        completeness,
        freshnessBlock: snapshot.metadata?.freshnessBlock || 0,
      });
    }
  }

  const receiptWallets = new Set(receipts.map((row) => row.receiver).filter(Boolean));
  const registeredWithoutSnapshot = [...registered.keys()].filter(
    (address) => !snapshots.some((row) => row.address === address)
  );
  const levelCounts = {};
  for (let level = 1; level <= 10; level += 1) {
    levelCounts[level] = [...activeLevels.values()].filter((levels) => levels.has(level)).length;
  }

  const eventCounts = {};
  for (const row of financialEvents) eventCounts[row.eventName] = (eventCounts[row.eventName] || 0) + 1;
  const escrowEventCounts = {};
  for (const row of escrowEvents) escrowEventCounts[row.eventName] = (escrowEventCounts[row.eventName] || 0) + 1;

  const maxBlock = (rows) => rows.reduce((max, row) => Math.max(max, Number(row.blockNumber || 0)), 0);
  const latestWrite = (rows) => rows.reduce((latest, row) => {
    const value = new Date(row.updatedAt || row.createdAt || row.timestamp || 0).getTime();
    return Math.max(latest, Number.isFinite(value) ? value : 0);
  }, 0);
  const indexedMaxBlock = Math.max(
    maxBlock([...registeredRows, ...activationRows]),
    maxBlock(receipts),
    maxBlock(financialEvents),
    maxBlock(escrowEvents)
  );
  const contractAddresses = [
    process.env.REGISTRATION_ADDRESS,
    process.env.LEVEL_MANAGER_ADDRESS,
    process.env.P4_ORBIT_ADDRESS,
    process.env.P12_ORBIT_ADDRESS,
    process.env.P39_ORBIT_ADDRESS,
    process.env.ESCROW_ADDRESS,
    process.env.LEVEL_SETTLEMENT_ROUTER_ADDRESS,
  ].filter(Boolean);
  const tailLogs = [];
  if (!skipTailLogs && liveProvider && indexedMaxBlock < liveHead) {
    for (let fromBlock = indexedMaxBlock + 1; fromBlock <= liveHead; fromBlock += tailChunkSize) {
      const toBlock = Math.min(fromBlock + tailChunkSize - 1, liveHead);
      tailLogs.push(...await liveProvider.getLogs({ address: contractAddresses, fromBlock, toBlock }));
    }
  }

  console.log(JSON.stringify({
    chainId,
    database: mongoose.connection.name,
    recency: {
      liveHead,
      liveRpc,
      liveRpcError: liveHead ? '' : liveRpcError,
      registrationMaxBlock: maxBlock([...registeredRows, ...activationRows]),
      receiptMaxBlock: maxBlock(receipts),
      financialMaxBlock: maxBlock(financialEvents),
      escrowMaxBlock: maxBlock(escrowEvents),
      latestRegistrationWrite: new Date(latestWrite([...registeredRows, ...activationRows])).toISOString(),
      latestReceiptWrite: new Date(latestWrite(receipts)).toISOString(),
      latestFinancialWrite: new Date(latestWrite(financialEvents)).toISOString(),
      latestEscrowWrite: new Date(latestWrite(escrowEvents)).toISOString(),
      latestSnapshotWrite: new Date(latestWrite(snapshots)).toISOString(),
      indexedTailStart: indexedMaxBlock + 1,
      indexedTailEnd: liveHead,
      unindexedContractLogCount: tailLogs.length,
      unindexedContractLogs: tailLogs.map((log) => ({
        address: log.address,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        index: log.index,
        topic0: log.topics[0] || '',
      })),
    },
    syncStates: syncStates.map((row) => ({
      key: row.key,
      lastProcessedBlock: row.lastProcessedBlock,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt,
      errorMessage: row.errorMessage,
    })),
    totals: {
      registeredEvents: registeredRows.length,
      uniqueRegisteredWallets: registered.size,
      levelActivationEvents: activationRows.length,
      uniqueActivatedWallets: activeLevels.size,
      receipts: receipts.length,
      receiptWallets: receiptWallets.size,
      financialEvents: financialEvents.length,
      escrowEvents: escrowEvents.length,
      orbitLevelSnapshots: snapshots.length,
      snapshotWallets: new Set(snapshots.map((row) => row.address)).size,
    },
    levelCounts,
    eventCounts,
    escrowEventCounts,
    snapshotCoverage: {
      registeredWithoutSnapshotCount: registeredWithoutSnapshot.length,
      registeredWithoutSnapshot,
      incompleteSnapshotCount: incompleteSnapshots.length,
      incompleteSnapshots,
    },
    upgradeSensitive: {
      boundarySensitiveCount: boundarySensitive.length,
      boundarySensitive,
      partialEscrowCount: partialEscrow.length,
      partialEscrow,
      cycledCount: cycled.length,
      cycled,
    },
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
