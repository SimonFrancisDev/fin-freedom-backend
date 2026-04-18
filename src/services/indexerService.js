import SyncState from '../models/SyncState.js';
import IndexedReceipt from '../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
import { getContracts } from '../blockchain/contracts.js';
import { safeRpcCall, getProviderHealthSnapshot } from '../blockchain/provider.js';
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
const cycleTracker = new Map();

const LIVE_TAIL_ENABLED = true;
const LIVE_TAIL_WINDOW_BLOCKS = 12;
const LIVE_TAIL_TARGET_KEYS = new Set([
  'registration',
  'levelManager',
  'p4Orbit',
  'p12Orbit',
  'p39Orbit',
]);
const LIVE_TAIL_EVERY_N_PASSES = 1;

let passCounter = 0;

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

async function getBlockCached(blockNumber) {
  const key = Number(blockNumber);

  if (blockCache.has(key)) {
    return blockCache.get(key);
  }

  const block = await safeRpcCall((provider) => provider.getBlock(blockNumber)).catch(() => null);

  if (block) {
    blockCache.set(key, block);
  }

  if (blockCache.size > 5000) {
    const oldestKey = blockCache.keys().next().value;
    if (oldestKey !== undefined) {
      blockCache.delete(oldestKey);
    }
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

async function getCurrentCycleForOrbit(orbitType, orbitOwner, level) {
  const key = `${orbitType}-${orbitOwner}-${level}`;

  if (cycleTracker.has(key)) {
    return cycleTracker.get(key);
  }

  const lastReset = await IndexedOrbitEvent.findOne({
    orbitType,
    orbitOwner,
    level,
    eventName: 'OrbitReset',
  })
    .sort({ blockNumber: -1, logIndex: -1 })
    .lean();

  const currentCycle = lastReset ? Number(lastReset.cycleNumber || 0) + 1 : 1;

  cycleTracker.set(key, currentCycle);
  return currentCycle;
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
  const eventName = parsed.name;

  let orbitOwner = '';
  let user = '';
  let level = 0;
  let position = 0;
  let amount = '0';
  let cycleNumber = 0;
  let line = 0;
  let linePaymentNumber = 0;

  switch (eventName) {
    case 'PositionFilled': {
      orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
      user = toLower(args.user ?? args[1] ?? '');
      level = Number(args.level ?? args[2] ?? 0);
      position = Number(args.position ?? args[3] ?? 0);
      amount = stringifyBigInt(args.amount ?? args[4] ?? 0);

      cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
      break;
  }

   case 'OrbitReset': {
        orbitOwner = toLower(args.user ?? '');
        level = Number(args.level ?? 0);
        cycleNumber = Number(args.cycleNumber ?? 0);

        if (!orbitOwner) {
          console.warn('OrbitReset missing user field:', {
            txHash: log.transactionHash,
            logIndex: log.index,
            eventName,
            args,
          });
          return;
        }

        const key = `${orbitType}-${orbitOwner}-${level}`;
        cycleTracker.set(key, cycleNumber + 1);

        break;
      }

    case 'LinePaymentTracked':
    orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
    level = Number(args.level ?? args[1] ?? 0);
    line = Number(args.line ?? args[2] ?? 0);
    linePaymentNumber = Number(args.linePaymentNumber ?? args[3] ?? 0);
    position = Number(args.position ?? args[4] ?? 0);
    cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
    break;

    case 'PaymentRuleApplied':
    orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
    level = Number(args.level ?? args[1] ?? 0);
    position = Number(args.position ?? args[2] ?? 0);
    line = Number(args.line ?? args[3] ?? 0);
    linePaymentNumber = Number(args.linePaymentNumber ?? args[4] ?? 0);
    cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
    break;

    case 'EscrowUpdated':
    orbitOwner = toLower(args.orbitOwner ?? args.user ?? args[0] ?? '');
    level = Number(args.level ?? args[1] ?? 0);
    cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
    break;

    case 'AutoUpgradeTriggered':
    orbitOwner = toLower(args.user ?? args[0] ?? '');
    level = Number(args.fromLevel ?? args.level ?? args[1] ?? 0);
    amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
    cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
    break;

    case 'SpilloverPaid':
    orbitOwner = toLower(args.orbitOwner ?? args.from ?? args[0] ?? '');
    user = toLower(args.to ?? args.user ?? args[1] ?? '');
    level = Number(args.level ?? args[2] ?? 0);
    amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
    cycleNumber = await getCurrentCycleForOrbit(orbitType, orbitOwner, level);
    break;

    default:
      return;
  }

  if (!orbitOwner) {
    console.warn('Orbit event missing orbitOwner, skipping event:', {
      eventName,
      txHash: log.transactionHash,
      logIndex: log.index,
      args,
    });
    return;
  }

  await IndexedOrbitEvent.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        orbitType,
        contractAddress: toLower(contractAddress),
        eventName,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        orbitOwner,
        user,
        level,
        position,
        amount,
        cycleNumber,
        line,
        linePaymentNumber,
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
  contract,
  contractKey,
  contractAddress,
  fromBlock,
  toBlock,
  chainId,
  orbitType = null,
}) {
  const logs = await safeRpcCall((provider) =>
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

    const block = await getBlockCached(log.blockNumber);
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
          providerHealth: getProviderHealthSnapshot(),
        },
      },
    }
  );
}

async function processTargetChunk({
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
            providerHealth: getProviderHealthSnapshot(),
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
            providerHealth: getProviderHealthSnapshot(),
          },
        },
      }
    );

    try {
      const logCount = await processLogsForContract({
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
              providerHealth: getProviderHealthSnapshot(),
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
                providerHealth: getProviderHealthSnapshot(),
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
                providerHealth: getProviderHealthSnapshot(),
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
              providerHealth: getProviderHealthSnapshot(),
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

function buildLiveTailTargets(allTargets) {
  return allTargets.filter((target) => LIVE_TAIL_TARGET_KEYS.has(target.key));
}

async function processLiveTailTarget({
  chainId,
  latestBlock,
  target,
}) {
  const tailWindowStart = Math.max(
    Number(target.startBlock || 0),
    Math.max(0, latestBlock - LIVE_TAIL_WINDOW_BLOCKS + 1)
  );

  if (tailWindowStart > latestBlock) {
    return {
      key: target.key,
      processed: false,
      fromBlock: null,
      toBlock: null,
      logCount: 0,
    };
  }

  let currentFrom = tailWindowStart;
  let totalLogs = 0;
  let chunkSize = Math.max(1, Math.min(target.chunkSize, 6));
  let rateLimited = false;

  while (currentFrom <= latestBlock) {
    const currentTo = Math.min(currentFrom + chunkSize - 1, latestBlock);

    try {
      const logCount = await processLogsForContract({
        contract: target.contract,
        contractKey: target.key,
        contractAddress: target.address,
        fromBlock: currentFrom,
        toBlock: currentTo,
        chainId,
        orbitType: target.orbitType,
      });

      totalLogs += logCount;
      currentFrom = currentTo + 1;
      await sleep(20);
    } catch (error) {
      if (isBlockRangeLimitError(error) && chunkSize > 1) {
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
        continue;
      }

      if (isRateLimitError(error)) {
        rateLimited = true;
        setTargetBackoff(target.key, 3000);
        break;
      }

      console.error(`Live tail sync failed for ${target.key}:`, error);
      break;
    }
  }

  return {
    key: target.key,
    processed: !rateLimited,
    fromBlock: tailWindowStart,
    toBlock: latestBlock,
    logCount: totalLogs,
    rateLimited,
  };
}

async function runLiveTailSync({
  chainId,
  latestBlock,
  targets,
}) {
  if (!LIVE_TAIL_ENABLED) {
    return {
      enabled: false,
      results: [],
    };
  }

  if (passCounter % LIVE_TAIL_EVERY_N_PASSES !== 0) {
    return {
      enabled: true,
      skipped: true,
      windowBlocks: LIVE_TAIL_WINDOW_BLOCKS,
      results: [],
    };
  }

  const liveTailTargets = buildLiveTailTargets(targets);
  const results = [];

  for (const target of liveTailTargets) {
    const result = await processLiveTailTarget({
      chainId,
      latestBlock,
      target,
    });

    results.push(result);
    await sleep(30);
  }

  return {
    enabled: true,
    skipped: false,
    windowBlocks: LIVE_TAIL_WINDOW_BLOCKS,
    results,
  };
}

async function buildIndexerContext() {
  const contracts = getContracts();

  const network = await safeRpcCall((provider) => provider.getNetwork());
  const chainId = Number(network.chainId);

  const starts = getStartBlocks();
  const sync = getSyncConfig();

  const latestBlock = await safeRpcCall((provider) => provider.getBlockNumber());
  const safeBlock = Math.max(0, latestBlock - sync.confirmations);

  const targets = buildTargets(contracts, starts, sync)
    .sort((a, b) => a.priority - b.priority);

  return {
    chainId,
    starts,
    sync,
    latestBlock,
    safeBlock,
    targets,
  };
}

export async function runIndexerCycle(context = null) {
  const ctx = context || await buildIndexerContext();
  const results = [];

  for (const target of ctx.targets) {
    const result = await processTargetChunk({
      chainId: ctx.chainId,
      safeBlock: ctx.safeBlock,
      target,
    });

    results.push(result);
    await sleep(30);
  }

  return {
    latestBlock: ctx.latestBlock,
    safeBlock: ctx.safeBlock,
    results,
  };
}

export async function runIndexerPass() {
  passCounter += 1;
  const context = await buildIndexerContext();

  const liveTail = await runLiveTailSync({
    chainId: context.chainId,
    latestBlock: context.latestBlock,
    targets: context.targets,
  });

  const ordered = await runIndexerCycle(context);

  return {
    latestBlock: context.latestBlock,
    safeBlock: context.safeBlock,
    liveTail,
    ordered,
    providerHealth: getProviderHealthSnapshot(),
  };
}

export async function runIndexerOnce() {
  return runIndexerPass();
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
        await runIndexerPass();
      } catch (err) {
        console.error('Indexer pass error:', err);

        if (isRateLimitError(err)) {
          await sleep(20000);
        }
      }

      if (stopRequested) break;

      await sleep(Math.max(1000, pollIntervalMs));
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
// import { getProvider, safeRpcCall, getProviderHealthSnapshot } from '../blockchain/provider.js';
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
// const targetBackoffUntil = new Map();

// const LIVE_TAIL_ENABLED = true;
// const LIVE_TAIL_WINDOW_BLOCKS = 12;

// const LIVE_TAIL_TARGET_KEYS = new Set([
//   'registration',
//   'levelManager',
//   'p4Orbit',
//   'p12Orbit',
//   'p39Orbit',
// ]);

// const LIVE_TAIL_EVERY_N_PASSES = 1;

// let passCounter = 0;

// function getTargetBackoffKey(targetKey) {
//   return `indexer-backoff:${targetKey}`;
// }

// function setTargetBackoff(targetKey, msFromNow) {
//   targetBackoffUntil.set(getTargetBackoffKey(targetKey), Date.now() + msFromNow);
// }

// function isTargetCoolingDown(targetKey) {
//   const until = targetBackoffUntil.get(getTargetBackoffKey(targetKey));
//   return typeof until === 'number' && until > Date.now();
// }

// function getTargetChunkSize(targetKey, syncChunkSize) {
//   const safeBase = Math.max(1, Number(syncChunkSize) || 1);

//   const preferred = {
//     registration: 10,
//     levelManager: 6,
//     p4Orbit: 5,
//     p12Orbit: 3,
//     p39Orbit: 2,
//   };

//   return Math.max(1, Math.min(preferred[targetKey] || safeBase, safeBase));
// }

// async function getBlockCached(blockNumber) {
//   const key = Number(blockNumber);

//   if (blockCache.has(key)) {
//     return blockCache.get(key);
//   }

//   const block = await safeRpcCall((provider) => provider.getBlock(blockNumber)).catch(() => null);

//   if (block) {
//     blockCache.set(key, block);
//   }

//   if (blockCache.size > 5000) {
//     const oldestKey = blockCache.keys().next().value;
//     if (oldestKey !== undefined) {
//       blockCache.delete(oldestKey);
//     }
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
//   const eventName = parsed.name;

//   let orbitOwner = '';
//   let user = '';
//   let level = 0;
//   let position = 0;
//   let amount = '0';
//   let cycleNumber = 0;
//   let line = 0;
//   let linePaymentNumber = 0;

//   switch (eventName) {
//     case 'PositionFilled':
//       orbitOwner = toLower(args.orbitOwner || args[0]);
//       user = toLower(args.user || args[1]);
//       level = Number(args.level || args[2] || 0);
//       position = Number(args.position || args[3] || 0);
//       amount = stringifyBigInt(args.amount || args[4] || 0);
//       break;
//     case 'OrbitReset': {
//       const owner =
//         args.orbitOwner ??
//         args.user ??
//         args[0];

//       if (!owner) {
//         console.warn('⚠️ OrbitReset missing owner:', parsed);
//         return; // ❗ skip bad data
//       }

//       orbitOwner = toLower(owner);
//       level = Number(args.level ?? args[1] ?? 0);
//       cycleNumber = Number(args.cycleNumber ?? args[2] ?? 0);
//       break;
//     }

//     case 'LinePaymentTracked':
//     case 'PaymentRuleApplied':
//       orbitOwner = toLower(args.orbitOwner || args[0]);
//       level = Number(args.level || args[1] || 0);
//       position = Number(args.position || args[2] || 0);
//       line = Number(args.line || args[3] || 0);
//       linePaymentNumber = Number(args.linePaymentNumber || args[4] || 0);
//       break;

//     case 'EscrowUpdated':
//     case 'AutoUpgradeTriggered':
//       orbitOwner = toLower(args.user || args[0]);
//       level = Number(args.level || args[1] || 0);
//       break;

//     case 'SpilloverPaid':
//       orbitOwner = toLower(args.from || args[0]);
//       level = Number(args.level || args[1] || 0);
//       amount = stringifyBigInt(args.amount || args[2] || 0);
//       break;
//   }

//   await IndexedOrbitEvent.updateOne(
//     { txHash: toLower(log.transactionHash), logIndex: log.index },
//     {
//       $setOnInsert: {
//         chainId,
//         orbitType,
//         contractAddress: toLower(contractAddress),
//         eventName,
//         txHash: toLower(log.transactionHash),
//         logIndex: log.index,
//         blockNumber: log.blockNumber,
//         blockHash: toLower(log.blockHash),

//         orbitOwner,
//         user,
//         level,
//         position,
//         amount,
//         cycleNumber,
//         line,
//         linePaymentNumber,

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
//   contract,
//   contractKey,
//   contractAddress,
//   fromBlock,
//   toBlock,
//   chainId,
//   orbitType = null,
// }) {
//   const logs = await safeRpcCall((provider) =>
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

//     const block = await getBlockCached(log.blockNumber);
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

//   return logs.length;
// }

// function buildTargets(contracts, starts, sync) {
//   return [
//     {
//       key: 'registration',
//       contract: contracts.registration,
//       address: contracts.registration.target,
//       startBlock: starts.registration ?? starts.levelManager ?? 0,
//       orbitType: null,
//       chunkSize: getTargetChunkSize('registration', sync.chunkSize),
//       priority: 1,
//     },
//     {
//       key: 'levelManager',
//       contract: contracts.levelManager,
//       address: contracts.levelManager.target,
//       startBlock: starts.levelManager,
//       orbitType: null,
//       chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
//       priority: 2,
//     },
//     {
//       key: 'p4Orbit',
//       contract: contracts.p4Orbit,
//       address: contracts.p4Orbit.target,
//       startBlock: starts.p4Orbit,
//       orbitType: 'P4',
//       chunkSize: getTargetChunkSize('p4Orbit', sync.chunkSize),
//       priority: 3,
//     },
//     {
//       key: 'p12Orbit',
//       contract: contracts.p12Orbit,
//       address: contracts.p12Orbit.target,
//       startBlock: starts.p12Orbit,
//       orbitType: 'P12',
//       chunkSize: getTargetChunkSize('p12Orbit', sync.chunkSize),
//       priority: 4,
//     },
//     {
//       key: 'p39Orbit',
//       contract: contracts.p39Orbit,
//       address: contracts.p39Orbit.target,
//       startBlock: starts.p39Orbit,
//       orbitType: 'P39',
//       chunkSize: getTargetChunkSize('p39Orbit', sync.chunkSize),
//       priority: 5,
//     },
//   ];
// }

// async function markTargetIdle(targetKey, safeBlock, lastProcessedBlock) {
//   const lagBlocks = Math.max(0, Number(safeBlock) - Number(lastProcessedBlock || 0));

//   await SyncState.updateOne(
//     { key: targetKey },
//     {
//       $set: {
//         status: 'idle',
//         lastSyncedAt: new Date(),
//         errorMessage: '',
//         meta: {
//           safeBlock,
//           lagBlocks,
//           lastChunkFrom: null,
//           lastChunkTo: null,
//           retryHint: '',
//           coolingDown: false,
//           providerHealth: getProviderHealthSnapshot(),
//         },
//       },
//     }
//   );
// }

// async function processTargetChunk({
//   chainId,
//   safeBlock,
//   target,
// }) {
//   const state = await getOrCreateSyncState(target.key, target.startBlock);

//   let fromBlock = Number(state.lastProcessedBlock || 0) + 1;
//   if (fromBlock === 1 && target.startBlock > 0) {
//     fromBlock = target.startBlock;
//   }

//   if (fromBlock > safeBlock) {
//     await markTargetIdle(target.key, safeBlock, state.lastProcessedBlock);
//     return {
//       key: target.key,
//       status: 'idle',
//       processed: false,
//       safeBlock,
//       lastProcessedBlock: state.lastProcessedBlock,
//       lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//     };
//   }

//   if (isTargetCoolingDown(target.key)) {
//     const lagBlocks = Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0));

//     await SyncState.updateOne(
//       { key: target.key },
//       {
//         $set: {
//           status: 'running',
//           errorMessage: '',
//           meta: {
//             safeBlock,
//             lagBlocks,
//             lastChunkFrom: null,
//             lastChunkTo: null,
//             retryHint: 'Cooling down after transient RPC issue',
//             coolingDown: true,
//             providerHealth: getProviderHealthSnapshot(),
//           },
//         },
//       }
//     );

//     return {
//       key: target.key,
//       status: 'cooldown',
//       processed: false,
//       safeBlock,
//       lastProcessedBlock: state.lastProcessedBlock,
//       lagBlocks,
//     };
//   }

//   const startedAt = Date.now();
//   let chunkSize = target.chunkSize;
//   let attempt = 0;

//   while (chunkSize >= 1) {
//     const toBlock = Math.min(fromBlock + chunkSize - 1, safeBlock);

//     await SyncState.updateOne(
//       { key: target.key },
//       {
//         $set: {
//           status: 'running',
//           errorMessage: '',
//           meta: {
//             safeBlock,
//             lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//             lastChunkFrom: fromBlock,
//             lastChunkTo: toBlock,
//             retryHint: '',
//             coolingDown: false,
//             providerHealth: getProviderHealthSnapshot(),
//           },
//         },
//       }
//     );

//     try {
//       const logCount = await processLogsForContract({
//         contract: target.contract,
//         contractKey: target.key,
//         contractAddress: target.address,
//         fromBlock,
//         toBlock,
//         chainId,
//         orbitType: target.orbitType,
//       });

//       const newLagBlocks = Math.max(0, safeBlock - toBlock);

//       await SyncState.updateOne(
//         { key: target.key },
//         {
//           $set: {
//             lastProcessedBlock: toBlock,
//             status: toBlock >= safeBlock ? 'idle' : 'running',
//             lastSyncedAt: new Date(),
//             errorMessage: '',
//             meta: {
//               safeBlock,
//               lagBlocks: newLagBlocks,
//               lastChunkFrom: fromBlock,
//               lastChunkTo: toBlock,
//               lastChunkDurationMs: Date.now() - startedAt,
//               lastChunkLogCount: logCount,
//               retryHint: '',
//               coolingDown: false,
//               providerHealth: getProviderHealthSnapshot(),
//             },
//           },
//         }
//       );

//       return {
//         key: target.key,
//         status: toBlock >= safeBlock ? 'idle' : 'running',
//         processed: true,
//         fromBlock,
//         toBlock,
//         lastProcessedBlock: toBlock,
//         safeBlock,
//         lagBlocks: newLagBlocks,
//         logCount,
//       };
//     } catch (error) {
//       attempt += 1;

//       if (isBlockRangeLimitError(error) && chunkSize > 1) {
//         chunkSize = Math.max(1, Math.floor(chunkSize / 2));

//         await SyncState.updateOne(
//           { key: target.key },
//           {
//             $set: {
//               status: 'running',
//               errorMessage: '',
//               meta: {
//                 safeBlock,
//                 lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//                 lastChunkFrom: fromBlock,
//                 lastChunkTo: toBlock,
//                 retryHint: `Reducing chunk size to ${chunkSize}`,
//                 coolingDown: false,
//                 providerHealth: getProviderHealthSnapshot(),
//               },
//             },
//           }
//         );

//         continue;
//       }

//       if (isRateLimitError(error)) {
//         const cooldownMs = Math.min(1500 * attempt, 6000);
//         setTargetBackoff(target.key, cooldownMs);

//         await SyncState.updateOne(
//           { key: target.key },
//           {
//             $set: {
//               status: 'running',
//               errorMessage: '',
//               meta: {
//                 safeBlock,
//                 lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//                 lastChunkFrom: fromBlock,
//                 lastChunkTo: toBlock,
//                 retryHint: `Rate-limited; cooling down for ${cooldownMs}ms`,
//                 coolingDown: true,
//                 providerHealth: getProviderHealthSnapshot(),
//               },
//             },
//           }
//         );

//         return {
//           key: target.key,
//           status: 'cooldown',
//           processed: false,
//           safeBlock,
//           lastProcessedBlock: state.lastProcessedBlock,
//           lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//         };
//       }

//       await SyncState.updateOne(
//         { key: target.key },
//         {
//           $set: {
//             status: 'error',
//             errorMessage: error.message || 'Unknown sync error',
//             meta: {
//               safeBlock,
//               lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//               lastChunkFrom: fromBlock,
//               lastChunkTo: toBlock,
//               retryHint: '',
//               coolingDown: false,
//               providerHealth: getProviderHealthSnapshot(),
//             },
//           },
//         }
//       );

//       throw error;
//     }
//   }

//   return {
//     key: target.key,
//     status: 'idle',
//     processed: false,
//     safeBlock,
//     lastProcessedBlock: state.lastProcessedBlock,
//     lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//   };
// }

// function buildLiveTailTargets(allTargets) {
//   return allTargets.filter((target) => LIVE_TAIL_TARGET_KEYS.has(target.key));
// }

// async function processLiveTailTarget({
//   chainId,
//   safeBlock,
//   target,
// }) {
//   const tailWindowStart = Math.max(
//     Number(target.startBlock || 0),
//     Math.max(0, safeBlock - LIVE_TAIL_WINDOW_BLOCKS + 1)
//   );

//   if (tailWindowStart > safeBlock) {
//     return {
//       key: target.key,
//       processed: false,
//       fromBlock: null,
//       toBlock: null,
//       logCount: 0,
//     };
//   }

//   let currentFrom = tailWindowStart;
//   let totalLogs = 0;
//   let chunkSize = Math.max(1, Math.min(target.chunkSize, 6));
//   let rateLimited = false;

//   while (currentFrom <= safeBlock) {
//     const currentTo = Math.min(currentFrom + chunkSize - 1, safeBlock);

//     try {
//       const logCount = await processLogsForContract({
//         contract: target.contract,
//         contractKey: target.key,
//         contractAddress: target.address,
//         fromBlock: currentFrom,
//         toBlock: currentTo,
//         chainId,
//         orbitType: target.orbitType,
//       });

//       totalLogs += logCount;
//       currentFrom = currentTo + 1;
//       await sleep(100);
//     } catch (error) {
//       if (isBlockRangeLimitError(error) && chunkSize > 1) {
//         chunkSize = Math.max(1, Math.floor(chunkSize / 2));
//         continue;
//       }

//       if (isRateLimitError(error)) {
//         rateLimited = true;
//         setTargetBackoff(target.key, 3000);
//         break;
//       }

//       console.error(`Live tail sync failed for ${target.key}:`, error);
//       break;
//     }
//   }

//   return {
//     key: target.key,
//     processed: !rateLimited,
//     fromBlock: tailWindowStart,
//     toBlock: safeBlock,
//     logCount: totalLogs,
//     rateLimited,
//   };
// }

// async function runLiveTailSync({
//   chainId,
//   safeBlock,
//   targets,
// }) {
//   if (!LIVE_TAIL_ENABLED) {
//     return {
//       enabled: false,
//       results: [],
//     };
//   }

//   if (passCounter % LIVE_TAIL_EVERY_N_PASSES !== 0) {
//     return {
//       enabled: true,
//       skipped: true,
//       windowBlocks: LIVE_TAIL_WINDOW_BLOCKS,
//       results: [],
//     };
//   }

//   const liveTailTargets = buildLiveTailTargets(targets);
//   const results = [];

//   for (const target of liveTailTargets) {
//     const result = await processLiveTailTarget({
//       chainId,
//       safeBlock,
//       target,
//     });

//     results.push(result);
//     await sleep(50);
//   }

//   return {
//     enabled: true,
//     skipped: false,
//     windowBlocks: LIVE_TAIL_WINDOW_BLOCKS,
//     results,
//   };
// }

// async function buildIndexerContext() {
//   const contracts = getContracts();

//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const chainId = Number(network.chainId);

//   const starts = getStartBlocks();
//   const sync = getSyncConfig();

//   const latestBlock = await safeRpcCall((provider) => provider.getBlockNumber());
//   const safeBlock = Math.max(0, latestBlock - sync.confirmations);

//   const targets = buildTargets(contracts, starts, sync)
//     .sort((a, b) => a.priority - b.priority);

//   return {
//     chainId,
//     starts,
//     sync,
//     latestBlock,
//     safeBlock,
//     targets,
//   };
// }

// export async function runIndexerCycle(context = null) {
//   const ctx = context || await buildIndexerContext();
//   const results = [];

//   for (const target of ctx.targets) {
//     const result = await processTargetChunk({
//       chainId: ctx.chainId,
//       safeBlock: ctx.safeBlock,
//       target,
//     });

//     results.push(result);
//     await sleep(30);
//   }

//   return {
//     latestBlock: ctx.latestBlock,
//     safeBlock: ctx.safeBlock,
//     results,
//   };
// }

// export async function runIndexerPass() {
//   passCounter += 1;
//   const context = await buildIndexerContext();

//   const liveTail = await runLiveTailSync({
//     chainId: context.chainId,
//     safeBlock: context.safeBlock,
//     targets: context.targets,
//   });

//   const ordered = await runIndexerCycle(context);

//   return {
//     latestBlock: context.latestBlock,
//     safeBlock: context.safeBlock,
//     liveTail,
//     ordered,
//     providerHealth: getProviderHealthSnapshot(),
//   };
// }

// export async function runIndexerOnce() {
//   return runIndexerPass();
// }

// let isRunning = false;
// let stopRequested = false;
// let runnerPromise = null;

// export async function startIndexer() {
//   const { pollIntervalMs } = getSyncConfig();

//   if (isRunning) return runnerPromise;

//   isRunning = true;
//   stopRequested = false;

//   runnerPromise = (async () => {
//     while (!stopRequested) {
//       try {
//         await runIndexerPass();
//       } catch (err) {
//         console.error('Indexer pass error:', err);

//         if (isRateLimitError(err)) {
//           await sleep(20000);
//         }
//       }

//       if (stopRequested) break;

//       await sleep(Math.max(5000, pollIntervalMs));
//     }

//     isRunning = false;
//     runnerPromise = null;
//   })();

//   return runnerPromise;
// }

// export function stopIndexer() {
//   stopRequested = true;
// }
