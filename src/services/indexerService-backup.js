import SyncState from '../models/SyncState.js';
import IndexedReceipt from '../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
import {
  safeRpcCall,
  getProviderHealthSnapshot,
  ensureRealtimeProviders,
  onNewBlock,
} from '../blockchain/provider.js';
import { getContracts } from '../blockchain/contracts.js';
import { getStartBlocks, getSyncConfig } from '../config/syncConfig.js';
import env from '../config/env.js';

function buildErrorMessage(error) {
  return (
    String(error?.error?.message || '') +
    ' ' +
    String(error?.shortMessage || '') +
    ' ' +
    String(error?.message || '') +
    ' ' +
    String(error?.info?.responseStatus || '') +
    ' ' +
    String(error?.info?.responseBody || '')
  ).trim();
}

function isBlockRangeLimitError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('eth_getlogs requests with up to a 10 block range') ||
    lower.includes('block range should work') ||
    lower.includes('limited to a 5 range') ||
    lower.includes('requested block range exceeds the limits') ||
    lower.includes('block range exceeds configured limit')
  );
}

function isRateLimitError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

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

function isOutOfCreditsError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('402') ||
    lower.includes('payment required') ||
    lower.includes('out of cu') ||
    lower.includes('out of credits') ||
    lower.includes('quota exceeded') ||
    lower.includes('upgrade required')
  );
}

function isDebugLoggingEnabled() {
  return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
}

function logDebug(...args) {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
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
const LIVE_TAIL_WINDOW_BLOCKS = 120;
const LIVE_TAIL_TARGET_KEYS = new Set([
  'registration',
  'levelManager',
  'p4Orbit',
  'p12Orbit',
  'p39Orbit',
]);
const LIVE_TAIL_EVERY_N_PASSES = 1;
const LIVE_TAIL_MAX_CHUNK_SIZE = 3;
const INTER_TARGET_DELAY_MS = 0;
const IMMEDIATE_PASS_DEBOUNCE_MS = 50;

let passCounter = 0;

let isRunning = false;
let stopRequested = false;
let runnerPromise = null;

let passInFlightPromise = null;
let pendingImmediatePass = false;
let immediatePassTimer = null;
let unsubscribeNewBlock = null;
let latestObservedBlock = 0;

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

  const block = await safeRpcCall((provider) =>
    provider.getBlock(blockNumber)
  ).catch((error) => {
    logDebug('[BLOCK_FETCH_FAILED]', {
      blockNumber,
      error: buildErrorMessage(error),
    });
    return null;
  });

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

  logDebug('[SAVED_RECEIPT]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    eventName: parsed.name,
    orbitOwner: toLower(args.orbitOwner),
    receiver: toLower(args.receiver),
    blockNumber: log.blockNumber,
  });
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

  logDebug('[SAVED_REGISTRATION_EVENT]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    eventName: parsed.name,
    user: toLower(args.user || ''),
    referrer: toLower(args.referrer || ''),
    level: Number(args.level || 0),
    blockNumber: log.blockNumber,
  });
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
        console.warn('[ORBIT_RESET_MISSING_USER]', {
          txHash: log.transactionHash,
          logIndex: log.index,
          eventName,
          args,
        });
        return;
      }

      cycleTracker.set(`${orbitType}-${orbitOwner}-${level}`, cycleNumber + 1);
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
    console.warn('[ORBIT_EVENT_MISSING_OWNER]', {
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

  logDebug('[SAVED_ORBIT_EVENT]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    eventName,
    orbitType,
    orbitOwner,
    user,
    level,
    position,
    cycleNumber,
    blockNumber: log.blockNumber,
  });
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

  logDebug('[GET_LOGS_RESULT]', {
    contractKey,
    contractAddress,
    fromBlock,
    toBlock,
    count: logs.length,
  });

  for (const log of logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch (error) {
      console.error('[PARSE_LOG_FAILED]', {
        contractKey,
        contractAddress,
        txHash: log.transactionHash,
        logIndex: log.index,
        topic0: log.topics?.[0],
        error: error?.message || String(error),
      });
      continue;
    }

    if (!parsed) continue;

    logDebug('[PARSED_LOG]', {
      contractKey,
      contractAddress,
      eventName: parsed.name,
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
    });

    const block = await getBlockCached(log.blockNumber);
    if (!block) {
      console.warn('[MISSING_BLOCK_FOR_LOG]', {
        contractKey,
        contractAddress,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
      });
      continue;
    }

    if (
      contractKey === 'registration' &&
      ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
    ) {
      await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
      continue;
    }

    if (
      contractKey === 'levelManager' &&
      parsed.name === 'DetailedPayoutReceiptRecorded'
    ) {
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

async function updateSyncState(targetKey, payload) {
  await SyncState.updateOne(
    { key: targetKey },
    { $set: payload },
    { upsert: true }
  );
}

async function markTargetIdle(targetKey, safeBlock, lastProcessedBlock) {
  const lagBlocks = Math.max(0, Number(safeBlock) - Number(lastProcessedBlock || 0));

  await updateSyncState(targetKey, {
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
  });
}

async function processTargetChunk({ chainId, safeBlock, target }) {
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

    await updateSyncState(target.key, {
      status: 'cooldown',
      errorMessage: '',
      meta: {
        safeBlock,
        lagBlocks,
        lastChunkFrom: null,
        lastChunkTo: null,
        retryHint: 'Cooling down after RPC issue',
        coolingDown: true,
        providerHealth: getProviderHealthSnapshot(),
      },
    });

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

    await updateSyncState(target.key, {
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
    });

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

      await updateSyncState(target.key, {
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
      });

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

      console.error('[INDEXER_CHUNK_ERROR]', {
        target: target.key,
        address: target.address,
        fromBlock,
        toBlock,
        chunkSize,
        attempt,
        message: buildErrorMessage(error),
      });

      // GAP DETECTION
      await updateSyncState(target.key, {
        status: 'gap',
        errorMessage: buildErrorMessage(error),
        meta: {
          gapFrom: fromBlock,
          gapTo: toBlock,
          retryRequired: true,
        },
      });
      setTargetBackoff(target.key, 2000);

      if (isBlockRangeLimitError(error) && chunkSize > 1) {
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));

        await updateSyncState(target.key, {
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
        });

        continue;
      }

      if (isRateLimitError(error) || isOutOfCreditsError(error)) {
        const cooldownMs = isOutOfCreditsError(error)
          ? Math.max(15000, Number(env.RPC_OUT_OF_CREDITS_COOLDOWN_MS) || 15000)
          : Math.min(1500 * attempt, 6000);

        setTargetBackoff(target.key, cooldownMs);

        await updateSyncState(target.key, {
          status: 'cooldown',
          errorMessage: '',
          meta: {
            safeBlock,
            lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
            lastChunkFrom: fromBlock,
            lastChunkTo: toBlock,
            retryHint: isOutOfCreditsError(error)
              ? `RPC provider out of credits; cooling down for ${cooldownMs}ms`
              : `Rate-limited; cooling down for ${cooldownMs}ms`,
            coolingDown: true,
            providerHealth: getProviderHealthSnapshot(),
          },
        });

        return {
          key: target.key,
          status: 'cooldown',
          processed: false,
          safeBlock,
          lastProcessedBlock: state.lastProcessedBlock,
          lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
        };
      }

      await updateSyncState(target.key, {
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
      });

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

async function processLiveTailTarget({ chainId, latestBlock, target }) {
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
  let chunkSize = Math.max(1, Math.min(target.chunkSize, LIVE_TAIL_MAX_CHUNK_SIZE));
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

      if (INTER_TARGET_DELAY_MS > 0) {
        await sleep(INTER_TARGET_DELAY_MS);
      }
    } catch (error) {
      console.error('[LIVE_TAIL_ERROR]', {
        target: target.key,
        address: target.address,
        fromBlock: currentFrom,
        toBlock: currentTo,
        chunkSize,
        message: buildErrorMessage(error),
      });

      if (isBlockRangeLimitError(error) && chunkSize > 1) {
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
        continue;
      }

      if (isRateLimitError(error) || isOutOfCreditsError(error)) {
        rateLimited = true;
        const cooldownMs = isOutOfCreditsError(error)
          ? Math.max(15000, Number(env.RPC_OUT_OF_CREDITS_COOLDOWN_MS) || 15000)
          : 3000;

        setTargetBackoff(target.key, cooldownMs);
        break;
      }

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

async function runLiveTailSync({ chainId, latestBlock, targets }) {
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

  const results = await Promise.all(
    liveTailTargets.map(async (target) => {
      try {
        return await processLiveTailTarget({
          chainId,
          latestBlock,
          target,
        });
      } catch (error) {
        console.error('[LIVE_TAIL_TARGET_ERROR]', {
          target: target.key,
          message: buildErrorMessage(error),
        });

        return {
          key: target.key,
          processed: false,
          fromBlock: null,
          toBlock: null,
          logCount: 0,
          rateLimited: false,
          error: buildErrorMessage(error),
        };
      }
    })
  );

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

  const targets = buildTargets(contracts, starts, sync).sort(
    (a, b) => a.priority - b.priority
  );

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
  const ctx = context || (await buildIndexerContext());

  let finalResults = [];
  let stillBehind = true;

  while (stillBehind) {
    const results = await Promise.all(
      ctx.targets.map(async (target) => {
        try {
          return await processTargetChunk({
            chainId: ctx.chainId,
            safeBlock: ctx.safeBlock,
            target,
          });
        } catch (error) {
          console.error('[INDEXER_TARGET_ERROR]', {
            target: target.key,
            message: buildErrorMessage(error),
          });

          return {
            key: target.key,
            status: 'error',
            processed: false,
            safeBlock: ctx.safeBlock,
            lastProcessedBlock: 0,
            lagBlocks: 0,
            error: buildErrorMessage(error),
          };
        }
      })
    );

    finalResults = results;

    stillBehind = results.some(
      (r) => r.processed && r.status !== 'idle'
    );
  }

  return {
    latestBlock: ctx.latestBlock,
    safeBlock: ctx.safeBlock,
    results: finalResults,
  };
}

export async function runIndexerPass() {
  blockCache.clear();
  passCounter += 1;
  const context = await buildIndexerContext();

  const liveTail = await runLiveTailSync({
    chainId: context.chainId,
    latestBlock: context.latestBlock,
    targets: context.targets,
  });

  const ordered = await runIndexerCycle(context);

  const maxLag = ordered.results.reduce(
    (max, item) => Math.max(max, Number(item?.lagBlocks || 0)),
    0
  );

  if (String(env.LOG_LEVEL || '').toLowerCase() === 'debug' || maxLag > 0) {
    console.log('[INDEXER_PASS_SUMMARY]', {
      latestBlock: context.latestBlock,
      safeBlock: context.safeBlock,
      maxLag,
      liveTailResults: liveTail.results?.length || 0,
      orderedResults: ordered.results?.length || 0,
      liveTailError: liveTail.error || '',
      latestObservedBlock,
    });
  }

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

async function runIndexerPassGuarded(reason = 'manual') {
  if (passInFlightPromise) {
    pendingImmediatePass = true;
    logDebug('[INDEXER_PASS_COALESCED]', { reason });
    return passInFlightPromise;
  }

  passInFlightPromise = (async () => {
    try {
      logDebug('[INDEXER_PASS_START]', { reason });
      return await runIndexerPass();
    } finally {
      passInFlightPromise = null;

      if (pendingImmediatePass && !stopRequested) {
        pendingImmediatePass = false;

        Promise.resolve()
          .then(() => runIndexerPassGuarded('coalesced-follow-up'))
          .catch((error) => {
            console.error('[INDEXER_PASS_FOLLOW_UP_ERROR]', buildErrorMessage(error));
          });
      }
    }
  })();

  return passInFlightPromise;
}

function scheduleImmediatePass(reason = 'block-event') {
  pendingImmediatePass = true;

  if (immediatePassTimer) {
    clearTimeout(immediatePassTimer);
    immediatePassTimer = null;
  }

  immediatePassTimer = setTimeout(() => {
    immediatePassTimer = null;

    if (stopRequested || !isRunning) {
      return;
    }

    runIndexerPassGuarded(reason).catch((error) => {
      console.error('[INDEXER_IMMEDIATE_PASS_ERROR]', buildErrorMessage(error));
    });
  }, IMMEDIATE_PASS_DEBOUNCE_MS);
}

function startRealtimeBlockSubscription() {
  if (unsubscribeNewBlock) return;

  unsubscribeNewBlock = onNewBlock((blockNumber) => {
    latestObservedBlock = Math.max(latestObservedBlock, Number(blockNumber || 0));
    logDebug('[INDEXER_NEW_BLOCK]', { blockNumber: Number(blockNumber || 0) });
    scheduleImmediatePass('new-block');
  });
}

function stopRealtimeBlockSubscription() {
  if (typeof unsubscribeNewBlock === 'function') {
    try {
      unsubscribeNewBlock();
    } catch {
      // ignore
    }
  }

  unsubscribeNewBlock = null;
}

export async function startIndexer() {
  const { pollIntervalMs } = getSyncConfig();

  if (isRunning) return runnerPromise;

  isRunning = true;
  stopRequested = false;
  pendingImmediatePass = false;
  latestObservedBlock = 0;

  await ensureRealtimeProviders().catch((error) => {
    console.error('[INDEXER_REALTIME_BOOTSTRAP_ERROR]', buildErrorMessage(error));
  });

  startRealtimeBlockSubscription();

  runnerPromise = (async () => {
    await runIndexerPassGuarded('startup');

    while (!stopRequested) {
      try {
        await sleep(Math.max(500, pollIntervalMs));
      } catch {
        // ignore
      }

      if (stopRequested) break;

      try {
        await runIndexerPassGuarded('scheduled-poll');
      } catch (error) {
        console.error('[INDEXER_PASS_ERROR]', buildErrorMessage(error));

        if (isRateLimitError(error) || isOutOfCreditsError(error)) {
          await sleep(20000);
        }
      }
    }

    if (immediatePassTimer) {
      clearTimeout(immediatePassTimer);
      immediatePassTimer = null;
    }

    stopRealtimeBlockSubscription();

    isRunning = false;
    runnerPromise = null;
    passInFlightPromise = null;
    pendingImmediatePass = false;
  })();

  return runnerPromise;
}

export function stopIndexer() {
  stopRequested = true;

  if (immediatePassTimer) {
    clearTimeout(immediatePassTimer);
    immediatePassTimer = null;
  }

  stopRealtimeBlockSubscription();
}
