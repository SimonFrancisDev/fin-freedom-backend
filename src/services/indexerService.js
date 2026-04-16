import SyncState from '../models/SyncState.js';
import IndexedReceipt from '../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
import { getContracts } from '../blockchain/contracts.js';
import { getProvider, safeRpcCall } from '../blockchain/provider.js';
import { getStartBlocks, getSyncConfig } from '../config/syncConfig.js';

function isBlockRangeLimitError(error) {
  const message =
    error?.error?.message ||
    error?.shortMessage ||
    error?.message ||
    '';

  const lower = String(message).toLowerCase();

  return (
    lower.includes('eth_getlogs requests with up to a 10 block range') ||
    lower.includes('block range should work')
  );
}

function isRateLimitError(error) {
  const message =
    error?.error?.message ||
    error?.shortMessage ||
    error?.message ||
    '';

  const lower = String(message).toLowerCase();

  return (
    lower.includes('429') ||
    lower.includes('1015') ||
    lower.includes('throughput') ||
    lower.includes('compute units per second') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('exceeded maximum retry limit')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toLower(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function toDateFromSeconds(value) {
  const num = Number(value || 0);
  return new Date(num * 1000);
}

function stringifyBigInt(value) {
  if (value === undefined || value === null) return '0';
  return value.toString();
}

const blockCache = new Map();
const targetBackoffUntil = new Map();

function getTargetBackoffKey(targetKey) {
  return `indexer-backoff:${targetKey}`;
}

function setTargetBackoff(targetKey, msFromNow) {
  targetBackoffUntil.set(getTargetBackoffKey(targetKey), Date.now() + msFromNow);
}

function isTargetCoolingDown(targetKey) {
  const until = targetBackoffUntil.get(getTargetBackoffKey(targetKey));
  return typeof until === 'number' && until > Date.now();
}

function getTargetChunkSize(targetKey, syncChunkSize) {
  const safeBase = Math.max(1, Number(syncChunkSize) || 1);

  const preferred = {
    registration: 10,
    levelManager: 6,
    p4Orbit: 5,
    p12Orbit: 3,
    p39Orbit: 2,
  };

  return Math.max(1, Math.min(preferred[targetKey] || safeBase, safeBase));
}

async function getBlockCached(provider, blockNumber) {
  const key = Number(blockNumber);

  if (blockCache.has(key)) {
    return blockCache.get(key);
  }

  const block = await safeRpcCall(() => provider.getBlock(blockNumber)).catch(() => null);

  if (block) {
    blockCache.set(key, block);
  }

  return block;
}

async function getOrCreateSyncState(key, fallbackStartBlock) {
  let state = await SyncState.findOne({ key });

  if (!state) {
    state = await SyncState.create({
      key,
      lastProcessedBlock: fallbackStartBlock > 0 ? fallbackStartBlock - 1 : 0,
      status: 'idle',
      meta: {},
      lastSyncedAt: null,
      errorMessage: '',
    });
  }

  return state;
}

async function saveReceiptLog(chainId, log, parsed, block) {
  const args = parsed.args;

  await IndexedReceipt.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        receiver: toLower(args.receiver),
        activationId: stringifyBigInt(args.activationId),
        receiptType: Number(args.receiptType),
        level: Number(args.level),
        fromUser: toLower(args.fromUser),
        orbitOwner: toLower(args.orbitOwner),
        sourcePosition: Number(args.sourcePosition),
        sourceCycle: Number(args.sourceCycle),
        mirroredPosition: Number(args.mirroredPosition),
        mirroredCycle: Number(args.mirroredCycle),
        routedRole: Number(args.routedRole),
        grossAmount: stringifyBigInt(args.grossAmount),
        escrowLocked: stringifyBigInt(args.escrowLocked),
        liquidPaid: stringifyBigInt(args.liquidPaid),
        timestamp: toDateFromSeconds(block.timestamp),
        rawEventName: parsed.name,
      },
    },
    { upsert: true }
  );
}

async function saveRegistrationLog(chainId, contractAddress, log, parsed, block) {
  const args = parsed.args || {};

  await IndexedRegistrationEvent.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        contractAddress: toLower(contractAddress),
        eventName: parsed.name,
        user: toLower(args.user || ''),
        referrer: toLower(args.referrer || ''),
        level: Number(args.level || 0),
        timestamp: toDateFromSeconds(block.timestamp),
        raw: Object.fromEntries(
          Object.entries(args).map(([k, v]) => [
            k,
            typeof v === 'bigint' ? v.toString() : v,
          ])
        ),
      },
    },
    { upsert: true }
  );
}

async function saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block) {
  const args = parsed.args || {};

  await IndexedOrbitEvent.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        orbitType,
        contractAddress: toLower(contractAddress),
        eventName: parsed.name,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        orbitOwner: toLower(args.orbitOwner || ''),
        user: toLower(args.user || ''),
        level: Number(args.level || 0),
        position: Number(args.position || 0),
        amount: stringifyBigInt(args.amount || 0),
        cycleNumber: Number(args.cycleNumber || 0),
        line: Number(args.line || 0),
        linePaymentNumber: Number(args.linePaymentNumber || 0),
        timestamp: toDateFromSeconds(block.timestamp),
        raw: Object.fromEntries(
          Object.entries(args).map(([k, v]) => [
            k,
            typeof v === 'bigint' ? v.toString() : v,
          ])
        ),
      },
    },
    { upsert: true }
  );
}

async function processLogsForContract({
  provider,
  contract,
  contractKey,
  contractAddress,
  fromBlock,
  toBlock,
  chainId,
  orbitType = null,
}) {
  const logs = await safeRpcCall(() =>
    provider.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
    })
  );

  for (const log of logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }

    if (!parsed) continue;

    const block = await getBlockCached(provider, log.blockNumber);
    if (!block) continue;

    if (
      contractKey === 'registration' &&
      ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
    ) {
      await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
      continue;
    }

    if (contractKey === 'levelManager' && parsed.name === 'DetailedPayoutReceiptRecorded') {
      await saveReceiptLog(chainId, log, parsed, block);
      continue;
    }

    if (
      orbitType &&
      [
        'PositionFilled',
        'OrbitReset',
        'LinePaymentTracked',
        'PaymentRuleApplied',
        'SpilloverPaid',
        'EscrowUpdated',
        'AutoUpgradeTriggered',
      ].includes(parsed.name)
    ) {
      await saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block);
    }
  }

  return logs.length;
}

function buildTargets(contracts, starts, sync) {
  return [
    {
      key: 'registration',
      contract: contracts.registration,
      address: contracts.registration.target,
      startBlock: starts.registration ?? starts.levelManager ?? 0,
      orbitType: null,
      chunkSize: getTargetChunkSize('registration', sync.chunkSize),
      priority: 1,
    },
    {
      key: 'levelManager',
      contract: contracts.levelManager,
      address: contracts.levelManager.target,
      startBlock: starts.levelManager,
      orbitType: null,
      chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
      priority: 2,
    },
    {
      key: 'p4Orbit',
      contract: contracts.p4Orbit,
      address: contracts.p4Orbit.target,
      startBlock: starts.p4Orbit,
      orbitType: 'P4',
      chunkSize: getTargetChunkSize('p4Orbit', sync.chunkSize),
      priority: 3,
    },
    {
      key: 'p12Orbit',
      contract: contracts.p12Orbit,
      address: contracts.p12Orbit.target,
      startBlock: starts.p12Orbit,
      orbitType: 'P12',
      chunkSize: getTargetChunkSize('p12Orbit', sync.chunkSize),
      priority: 4,
    },
    {
      key: 'p39Orbit',
      contract: contracts.p39Orbit,
      address: contracts.p39Orbit.target,
      startBlock: starts.p39Orbit,
      orbitType: 'P39',
      chunkSize: getTargetChunkSize('p39Orbit', sync.chunkSize),
      priority: 5,
    },
  ];
}

async function markTargetIdle(targetKey, safeBlock, lastProcessedBlock) {
  const lagBlocks = Math.max(0, Number(safeBlock) - Number(lastProcessedBlock || 0));

  await SyncState.updateOne(
    { key: targetKey },
    {
      $set: {
        status: 'idle',
        lastSyncedAt: new Date(),
        errorMessage: '',
        meta: {
          safeBlock,
          lagBlocks,
          lastChunkFrom: null,
          lastChunkTo: null,
          retryHint: '',
          coolingDown: false,
        },
      },
    }
  );
}

async function processTargetChunk({
  provider,
  chainId,
  safeBlock,
  target,
}) {
  const state = await getOrCreateSyncState(target.key, target.startBlock);

  let fromBlock = Number(state.lastProcessedBlock || 0) + 1;
  if (fromBlock === 1 && target.startBlock > 0) {
    fromBlock = target.startBlock;
  }

  if (fromBlock > safeBlock) {
    await markTargetIdle(target.key, safeBlock, state.lastProcessedBlock);
    return {
      key: target.key,
      status: 'idle',
      processed: false,
      safeBlock,
      lastProcessedBlock: state.lastProcessedBlock,
      lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
    };
  }

  if (isTargetCoolingDown(target.key)) {
    const lagBlocks = Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0));

    await SyncState.updateOne(
      { key: target.key },
      {
        $set: {
          status: 'running',
          errorMessage: '',
          meta: {
            safeBlock,
            lagBlocks,
            lastChunkFrom: null,
            lastChunkTo: null,
            retryHint: 'Cooling down after transient RPC issue',
            coolingDown: true,
          },
        },
      }
    );

    return {
      key: target.key,
      status: 'cooldown',
      processed: false,
      safeBlock,
      lastProcessedBlock: state.lastProcessedBlock,
      lagBlocks,
    };
  }

  const startedAt = Date.now();
  let chunkSize = target.chunkSize;
  let attempt = 0;

  while (chunkSize >= 1) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, safeBlock);

    await SyncState.updateOne(
      { key: target.key },
      {
        $set: {
          status: 'running',
          errorMessage: '',
          meta: {
            safeBlock,
            lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
            lastChunkFrom: fromBlock,
            lastChunkTo: toBlock,
            retryHint: '',
            coolingDown: false,
          },
        },
      }
    );

    try {
      const logCount = await processLogsForContract({
        provider,
        contract: target.contract,
        contractKey: target.key,
        contractAddress: target.address,
        fromBlock,
        toBlock,
        chainId,
        orbitType: target.orbitType,
      });

      const newLagBlocks = Math.max(0, safeBlock - toBlock);

      await SyncState.updateOne(
        { key: target.key },
        {
          $set: {
            lastProcessedBlock: toBlock,
            status: toBlock >= safeBlock ? 'idle' : 'running',
            lastSyncedAt: new Date(),
            errorMessage: '',
            meta: {
              safeBlock,
              lagBlocks: newLagBlocks,
              lastChunkFrom: fromBlock,
              lastChunkTo: toBlock,
              lastChunkDurationMs: Date.now() - startedAt,
              lastChunkLogCount: logCount,
              retryHint: '',
              coolingDown: false,
            },
          },
        }
      );

      return {
        key: target.key,
        status: toBlock >= safeBlock ? 'idle' : 'running',
        processed: true,
        fromBlock,
        toBlock,
        lastProcessedBlock: toBlock,
        safeBlock,
        lagBlocks: newLagBlocks,
        logCount,
      };
    } catch (error) {
      attempt += 1;

      if (isBlockRangeLimitError(error) && chunkSize > 1) {
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));

        await SyncState.updateOne(
          { key: target.key },
          {
            $set: {
              status: 'running',
              errorMessage: '',
              meta: {
                safeBlock,
                lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
                lastChunkFrom: fromBlock,
                lastChunkTo: toBlock,
                retryHint: `Reducing chunk size to ${chunkSize}`,
                coolingDown: false,
              },
            },
          }
        );

        continue;
      }

      if (isRateLimitError(error)) {
        const cooldownMs = Math.min(1500 * attempt, 6000);
        setTargetBackoff(target.key, cooldownMs);

        await SyncState.updateOne(
          { key: target.key },
          {
            $set: {
              status: 'running',
              errorMessage: '',
              meta: {
                safeBlock,
                lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
                lastChunkFrom: fromBlock,
                lastChunkTo: toBlock,
                retryHint: `Rate-limited; cooling down for ${cooldownMs}ms`,
                coolingDown: true,
              },
            },
          }
        );

        return {
          key: target.key,
          status: 'cooldown',
          processed: false,
          safeBlock,
          lastProcessedBlock: state.lastProcessedBlock,
          lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
        };
      }

      await SyncState.updateOne(
        { key: target.key },
        {
          $set: {
            status: 'error',
            errorMessage: error.message || 'Unknown sync error',
            meta: {
              safeBlock,
              lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
              lastChunkFrom: fromBlock,
              lastChunkTo: toBlock,
              retryHint: '',
              coolingDown: false,
            },
          },
        }
      );

      throw error;
    }
  }

  return {
    key: target.key,
    status: 'idle',
    processed: false,
    safeBlock,
    lastProcessedBlock: state.lastProcessedBlock,
    lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
  };
}

export async function runIndexerCycle() {
  const provider = getProvider();
  const contracts = getContracts();
  const network = await safeRpcCall(() => provider.getNetwork());
  const chainId = Number(network.chainId);

  const starts = getStartBlocks();
  const sync = getSyncConfig();

  const latestBlock = await safeRpcCall(() => provider.getBlockNumber());
  const safeBlock = Math.max(0, latestBlock - sync.confirmations);

  const targets = buildTargets(contracts, starts, sync)
    .sort((a, b) => a.priority - b.priority);

  const results = [];

  for (const target of targets) {
    const result = await processTargetChunk({
      provider,
      chainId,
      safeBlock,
      target,
    });

    results.push(result);

    await sleep(250);
  }

  return {
    latestBlock,
    safeBlock,
    results,
  };
}

export async function runIndexerOnce() {
  return runIndexerCycle();
}

let isRunning = false;
let stopRequested = false;
let runnerPromise = null;

export async function startIndexer() {
  const { pollIntervalMs } = getSyncConfig();

  if (isRunning) return runnerPromise;

  isRunning = true;
  stopRequested = false;

  runnerPromise = (async () => {
    while (!stopRequested) {
      try {
        await runIndexerCycle();
      } catch (err) {
        console.error('Indexer cycle error:', err);
      }

      if (stopRequested) break;

      await sleep(Math.max(1500, pollIntervalMs));
    }

    isRunning = false;
    runnerPromise = null;
  })();

  return runnerPromise;
}

export function stopIndexer() {
  stopRequested = true;
}









// import SyncState from '../models/SyncState.js';
// import IndexedReceipt from '../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
// import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
// import { getContracts } from '../blockchain/contracts.js';
// import { getProvider, safeRpcCall } from '../blockchain/provider.js';
// import { getStartBlocks, getSyncConfig } from '../config/syncConfig.js';

// function isBlockRangeLimitError(error) {
//   const message =
//     error?.error?.message ||
//     error?.shortMessage ||
//     error?.message ||
//     '';

//   const lower = String(message).toLowerCase();

//   return (
//     lower.includes('eth_getlogs requests with up to a 10 block range') ||
//     lower.includes('block range should work')
//   );
// }

// function isRateLimitError(error) {
//   const message =
//     error?.error?.message ||
//     error?.shortMessage ||
//     error?.message ||
//     '';

//   const lower = String(message).toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('exceeded maximum retry limit')
//   );
// }

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function toLower(value) {
//   return typeof value === 'string' ? value.toLowerCase() : value;
// }

// function toDateFromSeconds(value) {
//   const num = Number(value || 0);
//   return new Date(num * 1000);
// }

// function stringifyBigInt(value) {
//   if (value === undefined || value === null) return '0';
//   return value.toString();
// }

// const blockCache = new Map();

// async function getBlockCached(provider, blockNumber) {
//   const key = Number(blockNumber);

//   if (blockCache.has(key)) {
//     return blockCache.get(key);
//   }

//   const block = await safeRpcCall(() => provider.getBlock(blockNumber)).catch(() => null);

//   if (block) {
//     blockCache.set(key, block);
//   }

//   return block;
// }

// async function getOrCreateSyncState(key, fallbackStartBlock) {
//   let state = await SyncState.findOne({ key });

//   if (!state) {
//     state = await SyncState.create({
//       key,
//       lastProcessedBlock: fallbackStartBlock > 0 ? fallbackStartBlock - 1 : 0,
//       status: 'idle',
//       meta: {},
//       lastSyncedAt: null,
//       errorMessage: '',
//     });
//   }

//   return state;
// }

// async function saveReceiptLog(chainId, log, parsed, block) {
//   const args = parsed.args;

//   await IndexedReceipt.updateOne(
//     { txHash: toLower(log.transactionHash), logIndex: log.index },
//     {
//       $setOnInsert: {
//         chainId,
//         txHash: toLower(log.transactionHash),
//         logIndex: log.index,
//         blockNumber: log.blockNumber,
//         blockHash: toLower(log.blockHash),
//         receiver: toLower(args.receiver),
//         activationId: stringifyBigInt(args.activationId),
//         receiptType: Number(args.receiptType),
//         level: Number(args.level),
//         fromUser: toLower(args.fromUser),
//         orbitOwner: toLower(args.orbitOwner),
//         sourcePosition: Number(args.sourcePosition),
//         sourceCycle: Number(args.sourceCycle),
//         mirroredPosition: Number(args.mirroredPosition),
//         mirroredCycle: Number(args.mirroredCycle),
//         routedRole: Number(args.routedRole),
//         grossAmount: stringifyBigInt(args.grossAmount),
//         escrowLocked: stringifyBigInt(args.escrowLocked),
//         liquidPaid: stringifyBigInt(args.liquidPaid),
//         timestamp: toDateFromSeconds(block.timestamp),
//         rawEventName: parsed.name,
//       },
//     },
//     { upsert: true }
//   );
// }

// async function saveRegistrationLog(chainId, contractAddress, log, parsed, block) {
//   const args = parsed.args || {};

//   await IndexedRegistrationEvent.updateOne(
//     { txHash: toLower(log.transactionHash), logIndex: log.index },
//     {
//       $setOnInsert: {
//         chainId,
//         txHash: toLower(log.transactionHash),
//         logIndex: log.index,
//         blockNumber: log.blockNumber,
//         blockHash: toLower(log.blockHash),
//         contractAddress: toLower(contractAddress),
//         eventName: parsed.name,
//         user: toLower(args.user || ''),
//         referrer: toLower(args.referrer || ''),
//         level: Number(args.level || 0),
//         timestamp: toDateFromSeconds(block.timestamp),
//         raw: Object.fromEntries(
//           Object.entries(args).map(([k, v]) => [
//             k,
//             typeof v === 'bigint' ? v.toString() : v,
//           ])
//         ),
//       },
//     },
//     { upsert: true }
//   );
// }

// async function saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block) {
//   const args = parsed.args || {};

//   await IndexedOrbitEvent.updateOne(
//     { txHash: toLower(log.transactionHash), logIndex: log.index },
//     {
//       $setOnInsert: {
//         chainId,
//         orbitType,
//         contractAddress: toLower(contractAddress),
//         eventName: parsed.name,
//         txHash: toLower(log.transactionHash),
//         logIndex: log.index,
//         blockNumber: log.blockNumber,
//         blockHash: toLower(log.blockHash),
//         orbitOwner: toLower(args.orbitOwner || ''),
//         user: toLower(args.user || ''),
//         level: Number(args.level || 0),
//         position: Number(args.position || 0),
//         amount: stringifyBigInt(args.amount || 0),
//         cycleNumber: Number(args.cycleNumber || 0),
//         line: Number(args.line || 0),
//         linePaymentNumber: Number(args.linePaymentNumber || 0),
//         timestamp: toDateFromSeconds(block.timestamp),
//         raw: Object.fromEntries(
//           Object.entries(args).map(([k, v]) => [
//             k,
//             typeof v === 'bigint' ? v.toString() : v,
//           ])
//         ),
//       },
//     },
//     { upsert: true }
//   );
// }

// async function processLogsForContract({
//   provider,
//   contract,
//   contractKey,
//   contractAddress,
//   fromBlock,
//   toBlock,
//   chainId,
//   orbitType = null,
// }) {
//   const logs = await safeRpcCall(() =>
//     provider.getLogs({
//       address: contractAddress,
//       fromBlock,
//       toBlock,
//     })
//   );

//   for (const log of logs) {
//     let parsed;
//     try {
//       parsed = contract.interface.parseLog(log);
//     } catch {
//       continue;
//     }

//     if (!parsed) continue;

//     const block = await getBlockCached(provider, log.blockNumber);
//     if (!block) continue;

//     if (
//       contractKey === 'registration' &&
//       ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
//     ) {
//       await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
//       continue;
//     }

//     if (contractKey === 'levelManager' && parsed.name === 'DetailedPayoutReceiptRecorded') {
//       await saveReceiptLog(chainId, log, parsed, block);
//       continue;
//     }

//     if (
//       orbitType &&
//       [
//         'PositionFilled',
//         'OrbitReset',
//         'LinePaymentTracked',
//         'PaymentRuleApplied',
//         'SpilloverPaid',
//         'EscrowUpdated',
//         'AutoUpgradeTriggered',
//       ].includes(parsed.name)
//     ) {
//       await saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block);
//     }
//   }
// }

// export async function runIndexerOnce() {
//   const provider = getProvider();
//   const contracts = getContracts();
//   const network = await safeRpcCall(() => provider.getNetwork());
//   const chainId = Number(network.chainId);

//   const starts = getStartBlocks();
//   const sync = getSyncConfig();

//   const latestBlock = await safeRpcCall(() => provider.getBlockNumber());
//   const safeBlock = Math.max(0, latestBlock - sync.confirmations);

//   const targets = [
//     {
//       key: 'registration',
//       contract: contracts.registration,
//       address: contracts.registration.target,
//       startBlock: starts.registration ?? starts.levelManager ?? 0,
//       orbitType: null,
//     },
//     {
//       key: 'levelManager',
//       contract: contracts.levelManager,
//       address: contracts.levelManager.target,
//       startBlock: starts.levelManager,
//       orbitType: null,
//     },
//     {
//       key: 'p4Orbit',
//       contract: contracts.p4Orbit,
//       address: contracts.p4Orbit.target,
//       startBlock: starts.p4Orbit,
//       orbitType: 'P4',
//     },
//     {
//       key: 'p12Orbit',
//       contract: contracts.p12Orbit,
//       address: contracts.p12Orbit.target,
//       startBlock: starts.p12Orbit,
//       orbitType: 'P12',
//     },
//     {
//       key: 'p39Orbit',
//       contract: contracts.p39Orbit,
//       address: contracts.p39Orbit.target,
//       startBlock: starts.p39Orbit,
//       orbitType: 'P39',
//     },
//   ];

//   for (const target of targets) {
//     const state = await getOrCreateSyncState(target.key, target.startBlock);

//     let nextFrom = state.lastProcessedBlock + 1;
//     if (nextFrom === 1 && target.startBlock > 0) {
//       nextFrom = target.startBlock;
//     }

//     if (nextFrom > safeBlock) {
//       await SyncState.updateOne(
//         { key: target.key },
//         {
//           $set: {
//             status: 'idle',
//             lastSyncedAt: new Date(),
//             errorMessage: '',
//           },
//         }
//       );
//       continue;
//     }

//     await SyncState.updateOne(
//       { key: target.key },
//       {
//         $set: {
//           status: 'running',
//           errorMessage: '',
//         },
//       }
//     );

//     try {
//       let fromBlock = nextFrom;
//       let activeChunkSize = Math.min(sync.chunkSize, 3);
//       let retryDelayMs = 2000;

//       while (fromBlock <= safeBlock) {
//         await sleep(300);
//         const toBlock = Math.min(fromBlock + activeChunkSize - 1, safeBlock);

//         try {
//           await processLogsForContract({
//             provider,
//             contract: target.contract,
//             contractKey: target.key,
//             contractAddress: target.address,
//             fromBlock,
//             toBlock,
//             chainId,
//             orbitType: target.orbitType,
//           });

//           await SyncState.updateOne(
//             { key: target.key },
//             {
//               $set: {
//                 lastProcessedBlock: toBlock,
//                 status: 'running',
//                 lastSyncedAt: new Date(),
//                 errorMessage: '',
//               },
//             }
//           );

//           fromBlock = toBlock + 1;
//           retryDelayMs = 2000;
//         } catch (error) {
//           if (isBlockRangeLimitError(error) && activeChunkSize > 1) {
//             activeChunkSize = Math.max(1, Math.floor(activeChunkSize / 2));
//             continue;
//           }

//           if (isRateLimitError(error)) {
//             await sleep(retryDelayMs);
//             retryDelayMs = Math.min(retryDelayMs * 2, 20000);
//             continue;
//           }

//           throw error;
//         }
//       }

//       await SyncState.updateOne(
//         { key: target.key },
//         {
//           $set: {
//             status: 'idle',
//             lastSyncedAt: new Date(),
//             errorMessage: '',
//           },
//         }
//       );
//     } catch (error) {
//       await SyncState.updateOne(
//         { key: target.key },
//         {
//           $set: {
//             status: 'error',
//             errorMessage: error.message || 'Unknown sync error',
//           },
//         }
//       );
//       throw error;
//     }
//   }
// }

// let pollingHandle = null;
// let isRunning = false;

// export async function startIndexer() {
//   const { pollIntervalMs } = getSyncConfig();

//   if (pollingHandle) return;

//   pollingHandle = setInterval(async () => {
//     if (isRunning) return;
//     isRunning = true;

//     try {
//       await runIndexerOnce();
//     } catch (err) {
//       console.error('Indexer error:', err);
//     } finally {
//       isRunning = false;
//     }
//   }, pollIntervalMs);

//   if (!isRunning) {
//     isRunning = true;
//     try {
//       await runIndexerOnce();
//     } catch (err) {
//       console.error('Initial indexer run failed:', err);
//     } finally {
//       isRunning = false;
//     }
//   }
// }

// export function stopIndexer() {
//   if (pollingHandle) {
//     clearInterval(pollingHandle);
//     pollingHandle = null;
//   }
// }

