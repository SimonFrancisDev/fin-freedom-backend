import SyncState from '../models/SyncState.js';
import IndexedReceipt from '../models/IndexedReceipt.js';
import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
import IndexedTokenEvent from '../models/IndexedTokenEvent.js';
import IndexedEscrowEvent from '../models/IndexedEscrowEvent.js';
import IndexedActivationSummary from '../models/IndexedActivationSummary.js';
import IndexedFinancialEvent from '../models/IndexedFinancialEvent.js';
import IndexerGap from '../models/IndexerGap.js';
import ReferralCode from '../models/ReferralCode.js';
import { generateShortCode } from '../utils/shortCodeGenerator.js';
import {
  createAdminIndexerWarning,
  notifyFromIndexedEscrowEvent,
  notifyFromIndexedFinancialEvent,
  notifyFromIndexedReceipt,
  notifyFromIndexedTokenEvent,
} from './notifications/notificationService.js';
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
    lower.includes('billing') ||
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

function codeToString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    if (!value.startsWith('0x')) return value;
    try {
      return Buffer.from(value.slice(2), 'hex').toString('utf8').replace(/\0+$/g, '');
    } catch {
      return value;
    }
  }
  return String(value);
}

function rawArgs(args = {}) {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      typeof v === 'bigint' ? v.toString() : v,
    ])
  );
}

async function ensureReferralCodeForWallet(walletAddress) {
  const wallet = toLower(walletAddress || '');
  if (!wallet) return;

  const existing = await ReferralCode.findOne({ walletAddress: wallet }).select('_id').lean();
  if (existing) return;

  let shortCode;
  let attempts = 0;
  const maxAttempts = 20;

  do {
    shortCode = generateShortCode();
    attempts += 1;
  } while (await ReferralCode.exists({ shortCode }) && attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    throw new Error(`[REFERRAL_CODE_GENERATION_FAILED] ${wallet}`);
  }

  try {
    await ReferralCode.create({
      shortCode,
      walletAddress: wallet,
      isActive: true,
    });
  } catch (error) {
    if (Number(error?.code) !== 11000) {
      throw error;
    }
  }
}

const blockCache = new Map();
const targetBackoffUntil = new Map();
const targetLeaseRenewedAt = new Map();

const LIVE_TAIL_ENABLED = Boolean(env.INDEXER_LIVE_TAIL_ENABLED);
const LIVE_TAIL_WINDOW_BLOCKS = Number(env.INDEXER_LIVE_TAIL_WINDOW_BLOCKS || 12);
const LIVE_TAIL_TARGET_KEYS = new Set([
  'registration',
  'levelManager',
  'autoUpgradeEscrow',
  'p4Orbit',
  'p12Orbit',
  'p39Orbit',
  'fgtToken',
  'fgtrToken',
  'freedomTokenController'
]);
const LIVE_TAIL_EVERY_N_PASSES = Number(env.INDEXER_LIVE_TAIL_EVERY_N_PASSES || 120);
const LIVE_TAIL_MAX_CHUNK_SIZE = Number(env.INDEXER_LIVE_TAIL_MAX_CHUNK_SIZE || 12);
const INTER_TARGET_DELAY_MS = Number(env.INDEXER_INTER_TARGET_DELAY_MS || 25);
const IMMEDIATE_PASS_DEBOUNCE_MS = Number(env.INDEXER_IMMEDIATE_PASS_DEBOUNCE_MS || 10000);

let passCounter = 0;

let isRunning = false;
let stopRequested = false;
let runnerPromise = null;

let passInFlightPromise = null;
let pendingImmediatePass = false;
let immediatePassTimer = null;
let unsubscribeNewBlock = null;
let latestObservedBlock = 0;
let indexerOwnerId = null;
let indexerProcessRole = 'server';

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
    autoUpgradeEscrow: 6,
    p4Orbit: 5,
    p12Orbit: 3,
    p39Orbit: 2,
  };

  return Math.max(1, Math.min(preferred[targetKey] || safeBase, safeBase));
}

export async function getBlockCached(blockNumber) {
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

function getUpdateMatchedCount(result) {
  return Number(result?.matchedCount ?? result?.n ?? 0);
}

function buildGapKey(targetKey, fromBlock, toBlock) {
  return `${targetKey}:${Number(fromBlock)}:${Number(toBlock)}`;
}

function normalizeBlockRange(fromBlock, toBlock) {
  const from = Number(fromBlock);
  const to = Number(toBlock);

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new Error(`[INVALID_BLOCK_RANGE] from=${fromBlock} to=${toBlock}`);
  }

  return { fromBlock: from, toBlock: to };
}

function createIndexerOwnerId(processRole) {
  const random = Math.random().toString(36).slice(2);
  return `${processRole}:${process.pid}:${Date.now()}:${random}`;
}

function ensureIndexerOwner(processRole = 'server') {
  if (!indexerOwnerId) {
    indexerProcessRole = processRole || 'server';
    indexerOwnerId = createIndexerOwnerId(indexerProcessRole);
    console.log('[INDEXER_OWNER]', {
      ownerId: indexerOwnerId,
      processRole: indexerProcessRole,
    });
  }

  return indexerOwnerId;
}

function buildInsertedSyncState(targetKey, fallbackStartBlock) {
  return {
    key: targetKey,
    lastProcessedBlock: fallbackStartBlock > 0 ? fallbackStartBlock - 1 : 0,
    status: 'idle',
    meta: {},
    lastSyncedAt: null,
    errorMessage: '',
  };
}

async function ensureSyncStateDocument(target) {
  try {
    await SyncState.updateOne(
      { key: target.key },
      { $setOnInsert: buildInsertedSyncState(target.key, target.startBlock) },
      { upsert: true }
    );
  } catch (error) {
    if (Number(error?.code) !== 11000) {
      throw error;
    }
  }
}

function buildLeaseData(targetKey) {
  const { leaseTtlMs } = getSyncConfig();
  const now = new Date();

  return {
    ownerId: ensureIndexerOwner(indexerProcessRole),
    leaseUntil: new Date(now.getTime() + leaseTtlMs),
    heartbeatAt: now,
    processRole: indexerProcessRole,
    targetKey,
  };
}

async function acquireTargetLease(target) {
  await ensureSyncStateDocument(target);

  const now = new Date();
  const lease = buildLeaseData(target.key);
  const state = await SyncState.findOneAndUpdate(
    {
      key: target.key,
      $or: [
        { 'meta.lease.ownerId': { $exists: false } },
        { 'meta.lease.ownerId': lease.ownerId },
        { 'meta.lease.leaseUntil': { $exists: false } },
        { 'meta.lease.leaseUntil': { $lte: now } },
      ],
    },
    {
      $set: {
        'meta.lease': lease,
      },
    },
    {
      new: true,
    }
  );

  if (!state) {
    logDebug('[INDEXER_LEASE_HELD]', {
      target: target.key,
      ownerId: lease.ownerId,
      processRole: indexerProcessRole,
    });
    return null;
  }

  targetLeaseRenewedAt.set(target.key, Date.now());
  return state;
}

async function renewTargetLease(targetKey, { force = false } = {}) {
  const ownerId = ensureIndexerOwner(indexerProcessRole);
  const { leaseRenewMs } = getSyncConfig();
  const lastRenewedAt = Number(targetLeaseRenewedAt.get(targetKey) || 0);

  if (!force && Date.now() - lastRenewedAt < leaseRenewMs) {
    return true;
  }

  const lease = buildLeaseData(targetKey);
  const result = await SyncState.updateOne(
    {
      key: targetKey,
      'meta.lease.ownerId': ownerId,
    },
    {
      $set: {
        'meta.lease': lease,
      },
    }
  );

  if (getUpdateMatchedCount(result) === 0) {
    return false;
  }

  targetLeaseRenewedAt.set(targetKey, Date.now());
  return true;
}

async function assertLeaseOwned(targetKey) {
  const renewed = await renewTargetLease(targetKey, { force: true });

  if (!renewed) {
    throw new Error(
      `[INDEXER_LEASE_LOST] ${targetKey} is not owned by ${indexerOwnerId}`
    );
  }
}

async function releaseOwnedLeases(reason = 'shutdown') {
  if (!indexerOwnerId) return;

  const ownerId = indexerOwnerId;
  const now = new Date();

  await SyncState.updateMany(
    { 'meta.lease.ownerId': ownerId },
    {
      $set: {
        'meta.leaseReleasedAt': now,
        'meta.leaseReleaseReason': reason,
      },
      $unset: {
        'meta.lease.ownerId': '',
        'meta.lease.leaseUntil': '',
        'meta.lease.heartbeatAt': '',
        'meta.lease.processRole': '',
        'meta.lease.targetKey': '',
      },
    }
  );

  targetLeaseRenewedAt.clear();
}

async function recordIndexerGap({
  targetKey,
  fromBlock,
  toBlock,
  reason,
  error = null,
}) {
  const range = normalizeBlockRange(fromBlock, toBlock);
  const gapKey = buildGapKey(targetKey, range.fromBlock, range.toBlock);
  const now = new Date();
  const lastError = buildErrorMessage(error) || String(reason || '');

  await IndexerGap.updateOne(
    { gapKey },
    {
      $setOnInsert: {
        gapKey,
        targetKey,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        attempts: 0,
        firstDetectedAt: now,
      },
      $set: {
        reason: String(reason || ''),
        status: 'open',
        resolvedAt: null,
        lastError,
        ownerId: indexerOwnerId || '',
        processRole: indexerProcessRole || '',
      },
    },
    { upsert: true }
  );

  createAdminIndexerWarning({
    targetKey,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    reason,
    error: lastError,
  }).catch((alertError) => {
    console.error('[ADMIN_GAP_ALERT_FAILED]', alertError?.message || String(alertError));
  });

  return gapKey;
}

async function markGapReplayAttempt(gapKey, status = 'replaying') {
  const now = new Date();

  await IndexerGap.updateOne(
    { gapKey },
    {
      $inc: { attempts: 1 },
      $set: {
        status,
        lastAttemptAt: now,
        ownerId: indexerOwnerId || '',
        processRole: indexerProcessRole || '',
      },
    },
    { upsert: false }
  );
}

async function markGapResolved(gapKey) {
  const now = new Date();

  await IndexerGap.updateOne(
    { gapKey },
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        lastError: '',
        ownerId: indexerOwnerId || '',
        processRole: indexerProcessRole || '',
      },
    }
  );

  createAdminIndexerWarning({
    gapKey,
    status: 'resolved',
    error: '',
  }).catch((alertError) => {
    console.error('[ADMIN_GAP_REPLAY_ALERT_FAILED]', alertError?.message || String(alertError));
  });
}

async function markGapReplayFailed(gapKey, error) {
  await IndexerGap.updateOne(
    { gapKey },
    {
      $set: {
        status: 'failed',
        resolvedAt: null,
        lastError: buildErrorMessage(error),
        ownerId: indexerOwnerId || '',
        processRole: indexerProcessRole || '',
      },
    }
  );
}

export async function saveReceiptLog(chainId, log, parsed, block) {
  const args = parsed.args;
  const isDetailed = parsed.name === 'DetailedPayoutReceiptRecorded';

  await IndexedReceipt.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        receiver: toLower(args.receiver ?? args[0] ?? ''),
        activationId: stringifyBigInt(isDetailed ? (args.activationId ?? args[1] ?? 0) : 0),
        receiptType: Number(args.receiptType),
        level: Number(args.level),
        fromUser: toLower(args.fromUser ?? args[3] ?? ''),
        orbitOwner: toLower(args.orbitOwner ?? args[4] ?? ''),
        sourcePosition: Number(isDetailed ? (args.sourcePosition ?? args[6] ?? 0) : 0),
        sourceCycle: Number(isDetailed ? (args.sourceCycle ?? args[7] ?? 0) : 0),
        mirroredPosition: Number(isDetailed ? (args.mirroredPosition ?? args[8] ?? 0) : 0),
        mirroredCycle: Number(isDetailed ? (args.mirroredCycle ?? args[9] ?? 0) : 0),
        routedRole: Number(isDetailed ? (args.routedRole ?? args[10] ?? 0) : 0),
        grossAmount: stringifyBigInt(args.grossAmount ?? (isDetailed ? args[11] : args[5]) ?? 0),
        escrowLocked: stringifyBigInt(args.escrowLocked ?? (isDetailed ? args[12] : args[6]) ?? 0),
        liquidPaid: stringifyBigInt(args.liquidPaid ?? (isDetailed ? args[13] : args[7]) ?? 0),
        timestamp: toDateFromSeconds(block.timestamp),
        rawEventName: parsed.name,
      },
    },
    { upsert: true }
  );

  notifyFromIndexedReceipt({
    chainId,
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    blockNumber: log.blockNumber,
    blockHash: toLower(log.blockHash),
    receiver: toLower(args.receiver ?? args[0] ?? ''),
    activationId: stringifyBigInt(isDetailed ? (args.activationId ?? args[1] ?? 0) : 0),
    receiptType: Number(args.receiptType),
    level: Number(args.level),
    fromUser: toLower(args.fromUser ?? args[3] ?? ''),
    orbitOwner: toLower(args.orbitOwner ?? args[4] ?? ''),
    sourcePosition: Number(isDetailed ? (args.sourcePosition ?? args[6] ?? 0) : 0),
    sourceCycle: Number(isDetailed ? (args.sourceCycle ?? args[7] ?? 0) : 0),
    mirroredPosition: Number(isDetailed ? (args.mirroredPosition ?? args[8] ?? 0) : 0),
    mirroredCycle: Number(isDetailed ? (args.mirroredCycle ?? args[9] ?? 0) : 0),
    routedRole: Number(isDetailed ? (args.routedRole ?? args[10] ?? 0) : 0),
    grossAmount: stringifyBigInt(args.grossAmount ?? (isDetailed ? args[11] : args[5]) ?? 0),
    escrowLocked: stringifyBigInt(args.escrowLocked ?? (isDetailed ? args[12] : args[6]) ?? 0),
    liquidPaid: stringifyBigInt(args.liquidPaid ?? (isDetailed ? args[13] : args[7]) ?? 0),
    rawEventName: parsed.name,
  }).catch((error) => {
    console.error('[NOTIFICATION_RECEIPT_FAILED]', error?.message || String(error));
  });

  logDebug('[SAVED_RECEIPT]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    eventName: parsed.name,
    orbitOwner: toLower(args.orbitOwner),
    receiver: toLower(args.receiver),
    blockNumber: log.blockNumber,
  });
}

export async function saveRegistrationLog(chainId, contractAddress, log, parsed, block) {
  const args = parsed.args || {};
  const user = toLower(args.user || '');

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
        user,
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

  if (parsed.name === 'Registered') {
    try {
      await ensureReferralCodeForWallet(user);
    } catch (error) {
      console.error('[REFERRAL_CODE_CREATE_FAILED]', {
        user,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        message: buildErrorMessage(error),
      });
    }
  }

  logDebug('[SAVED_REGISTRATION_EVENT]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    eventName: parsed.name,
    user,
    referrer: toLower(args.referrer || ''),
    level: Number(args.level || 0),
    blockNumber: log.blockNumber,
  });
}

export async function saveEscrowLog(chainId, contractAddress, log, parsed, block) {
  const args = parsed.args || {};
  const eventName = parsed.name;

  const user = toLower(args.user ?? args[0] ?? '');
  const fromLevel = Number(args.fromLevel ?? args[1] ?? 0);
  const toLevel = Number(args.toLevel ?? args[2] ?? 0);

  let amount = '0';
  let newLockedTotal = '0';
  let currentEscrowLockedGlobal = '0';
  let recipient = '';

  if (eventName === 'EscrowLocked') {
    amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
    newLockedTotal = stringifyBigInt(args.newLockedTotal ?? args[4] ?? 0);
    currentEscrowLockedGlobal = stringifyBigInt(args.currentEscrowLockedGlobal ?? args[5] ?? 0);
  }

  if (eventName === 'EscrowUsedForUpgrade') {
    amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
    recipient = toLower(args.recipient ?? args[4] ?? '');
    currentEscrowLockedGlobal = stringifyBigInt(args.currentEscrowLockedGlobal ?? args[5] ?? 0);
  }

  if (eventName === 'EscrowReleasedToUser') {
    amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
    currentEscrowLockedGlobal = stringifyBigInt(args.currentEscrowLockedGlobal ?? args[4] ?? 0);
  }

  if (!user || !fromLevel || !toLevel) {
    const message = '[ESCROW_EVENT_MISSING_CORE_FIELDS]';
    console.error(message, {
      eventName,
      txHash: log.transactionHash,
      logIndex: log.index,
      args,
    });
    throw new Error(
      `${message} ${eventName} ${log.transactionHash}:${log.index}`
    );
  }

  await IndexedEscrowEvent.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),
        contractAddress: toLower(contractAddress),
        eventName,
        user,
        fromLevel,
        toLevel,
        amount,
        newLockedTotal,
        currentEscrowLockedGlobal,
        recipient,
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

  notifyFromIndexedEscrowEvent({
    chainId,
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    blockNumber: log.blockNumber,
    blockHash: toLower(log.blockHash),
    contractAddress: toLower(contractAddress),
    eventName,
    user,
    fromLevel,
    toLevel,
    amount,
    newLockedTotal,
    currentEscrowLockedGlobal,
    recipient,
  }).catch((error) => {
    console.error('[NOTIFICATION_ESCROW_FAILED]', error?.message || String(error));
  });

  logDebug('[SAVED_ESCROW_EVENT]', {
    eventName,
    user,
    fromLevel,
    toLevel,
    amount,
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
  });
}

export async function saveActivationSummaryLog(chainId, log, parsed, block) {
  const args = parsed.args || {};

  await IndexedActivationSummary.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: toLower(log.blockHash),

        activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
        user: toLower(args.user ?? args[1] ?? ''),
        level: Number(args.level ?? args[2] ?? 0),

        activationAmount: stringifyBigInt(args.activationAmount ?? args[3] ?? 0),
        systemCharge: stringifyBigInt(args.systemCharge ?? args[4] ?? 0),
        nftPoolAmount: stringifyBigInt(args.nftPoolAmount ?? args[5] ?? 0),
        operationsAmount: stringifyBigInt(args.operationsAmount ?? args[6] ?? 0),
        totalLiquidPaid: stringifyBigInt(args.totalLiquidPaid ?? args[7] ?? 0),
        totalEscrowLocked: stringifyBigInt(args.totalEscrowLocked ?? args[8] ?? 0),
        totalRecycleAllocated: stringifyBigInt(args.totalRecycleAllocated ?? args[9] ?? 0),

        isAutoUpgrade: Boolean(args.isAutoUpgrade ?? args[10] ?? false),
        isFounderRepFreeActivation: Boolean(args.isFounderRepFreeActivation ?? args[11] ?? false),

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

  logDebug('[SAVED_ACTIVATION_SUMMARY]', {
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
    user: toLower(args.user ?? args[1] ?? ''),
    level: Number(args.level ?? args[2] ?? 0),
  });
}

export async function saveFinancialEventLog(chainId, contractAddress, log, parsed, block) {
  const args = parsed.args || {};
  const eventName = parsed.name;

  const doc = {
    chainId,
    contractAddress: toLower(contractAddress),
    eventName,
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    blockNumber: log.blockNumber,
    blockHash: toLower(log.blockHash),
    timestamp: toDateFromSeconds(block.timestamp),
    raw: rawArgs(args),
  };

  if (eventName === 'PayoutNotDelivered') {
    Object.assign(doc, {
      affectedUser: toLower(args.affectedUser ?? args[0] ?? ''),
      sourceUser: toLower(args.sourceUser ?? args[1] ?? ''),
      level: Number(args.level ?? args[2] ?? 0),
      orbitType: Number(args.orbitType ?? args[3] ?? 0),
      sourcePosition: Number(args.sourcePosition ?? args[4] ?? 0),
      sourceCycle: Number(args.sourceCycle ?? args[5] ?? 0),
      expectedAmount: stringifyBigInt(args.expectedAmount ?? args[6] ?? 0),
      actualReceiver: toLower(args.actualReceiver ?? args[7] ?? ''),
      actualAmount: stringifyBigInt(args.actualAmount ?? args[8] ?? 0),
      receiptType: Number(args.receiptType ?? args[9] ?? 0),
      routedRole: codeToString(args.routedRole ?? args[10] ?? ''),
      reasonCode: codeToString(args.reasonCode ?? args[11] ?? ''),
      actionCode: codeToString(args.actionCode ?? args[12] ?? ''),
      activationId: stringifyBigInt(args.activationId ?? args[13] ?? 0),
    });
  }

  if (eventName === 'RecycleCompletedDetailed') {
    Object.assign(doc, {
      activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
      orbitOwner: toLower(args.orbitOwner ?? args[1] ?? ''),
      level: Number(args.level ?? args[2] ?? 0),
      sourceUser: toLower(args.sourceUser ?? args[3] ?? ''),
      sourcePosition: Number(args.sourcePosition ?? args[4] ?? 0),
      sourceCycle: Number(args.sourceCycle ?? args[5] ?? 0),
      recycleReceiver: toLower(args.recycleReceiver ?? args[6] ?? ''),
      recycleGross: stringifyBigInt(args.recycleGross ?? args[7] ?? 0),
      recycleLiquidPaid: stringifyBigInt(args.recycleLiquidPaid ?? args[8] ?? 0),
      recycleEscrowLocked: stringifyBigInt(args.recycleEscrowLocked ?? args[9] ?? 0),
      mirrorPosition: Number(args.mirrorPosition ?? args[10] ?? 0),
      mirrorCycle: Number(args.mirrorCycle ?? args[11] ?? 0),
      triggeredOrbitReset: Boolean(args.triggeredOrbitReset ?? args[12] ?? false),
    });
  }

  if (eventName === 'AutoUpgradeCompleted') {
    Object.assign(doc, {
      activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
      user: toLower(args.user ?? args[1] ?? ''),
      fromLevel: Number(args.fromLevel ?? args[2] ?? 0),
      toLevel: Number(args.toLevel ?? args[3] ?? 0),
      level: Number(args.toLevel ?? args[3] ?? 0),
      requiredAmount: stringifyBigInt(args.requiredAmount ?? args[4] ?? 0),
      usedAmount: stringifyBigInt(args.usedAmount ?? args[5] ?? 0),
      escrowBefore: stringifyBigInt(args.escrowBefore ?? args[6] ?? 0),
      escrowAfter: stringifyBigInt(args.escrowAfter ?? args[7] ?? 0),
    });
  }

  if (eventName === 'FounderDistributionDetailed') {
    Object.assign(doc, {
      activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
      sourceUser: toLower(args.sourceUser ?? args[1] ?? ''),
      level: Number(args.level ?? args[2] ?? 0),
      founderWallet: toLower(args.founderWallet ?? args[3] ?? ''),
      founderAmount: stringifyBigInt(args.amount ?? args[4] ?? 0),
      reasonCode: codeToString(args.reasonCode ?? args[6] ?? ''),
    });
  }

  if (eventName === 'SystemChargeDistributedDetailed') {
    Object.assign(doc, {
      activationId: stringifyBigInt(args.activationId ?? args[0] ?? 0),
      user: toLower(args.user ?? args[1] ?? ''),
      level: Number(args.level ?? args[2] ?? 0),
      systemChargeTotal: stringifyBigInt(args.systemChargeTotal ?? args[3] ?? 0),
      nftPoolAmount: stringifyBigInt(args.nftPoolAmount ?? args[4] ?? 0),
      operationsAmount: stringifyBigInt(args.operationsAmount ?? args[5] ?? 0),
    });
  }

  if (eventName === 'TokenRewardEligibility') {
    Object.assign(doc, {
      user: toLower(args.user ?? args[0] ?? ''),
      level: Number(args.level ?? args[1] ?? 0),
      rewardType: codeToString(args.rewardType ?? args[2] ?? ''),
      tokenAmount: stringifyBigInt(args.amount ?? args[3] ?? 0),
      eligible: Boolean(args.eligible ?? args[4] ?? false),
      reasonCode: codeToString(args.reasonCode ?? args[5] ?? ''),
    });
  }

  await IndexedFinancialEvent.updateOne(
    { txHash: doc.txHash, logIndex: doc.logIndex },
    { $setOnInsert: doc },
    { upsert: true }
  );

  notifyFromIndexedFinancialEvent(doc).catch((error) => {
    console.error('[NOTIFICATION_FINANCIAL_FAILED]', error?.message || String(error));
  });

  logDebug('[SAVED_FINANCIAL_EVENT]', {
    eventName,
    txHash: doc.txHash,
    logIndex: doc.logIndex,
  });
}

export async function saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block) {
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

  // Helper function to get cycle number from latest reset before this log
  async function getCycleNumberFromResets() {
    const latestReset = await IndexedOrbitEvent.findOne({
      orbitType,
      orbitOwner,
      level,
      eventName: 'OrbitReset',
      $or: [
        { blockNumber: { $lt: log.blockNumber } },
        {
          blockNumber: log.blockNumber,
          logIndex: { $lt: log.index },
        },
      ],
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .lean();

    return latestReset ? Number(latestReset.cycleNumber || 0) + 1 : 1;
  }

  switch (eventName) {
    case 'PositionFilled': {
      orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
      user = toLower(args.user ?? args[1] ?? '');
      level = Number(args.level ?? args[2] ?? 0);
      position = Number(args.position ?? args[3] ?? 0);
      amount = stringifyBigInt(args.amount ?? args[4] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'OrbitReset': {
      orbitOwner = toLower(args.user ?? '');
      level = Number(args.level ?? 0);
      cycleNumber = Number(args.cycleNumber ?? 0);

      if (!orbitOwner) {
        const message = '[ORBIT_RESET_MISSING_USER]';
        console.error(message, {
          txHash: log.transactionHash,
          logIndex: log.index,
          eventName,
          args,
        });
        throw new Error(
          `${message} ${eventName} ${log.transactionHash}:${log.index}`
        );
      }
      break;
    }

    case 'LinePaymentTracked': {
      orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
      level = Number(args.level ?? args[1] ?? 0);
      line = Number(args.line ?? args[2] ?? 0);
      linePaymentNumber = Number(args.linePaymentNumber ?? args[3] ?? 0);
      position = Number(args.position ?? args[4] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'PaymentRuleApplied': {
      orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
      level = Number(args.level ?? args[1] ?? 0);
      position = Number(args.position ?? args[2] ?? 0);
      line = Number(args.line ?? args[3] ?? 0);
      linePaymentNumber = Number(args.linePaymentNumber ?? args[4] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'EscrowUpdated': {
      orbitOwner = toLower(args.orbitOwner ?? args.user ?? args[0] ?? '');
      level = Number(args.level ?? args[1] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'AutoUpgradeTriggered': {
      orbitOwner = toLower(args.user ?? args[0] ?? '');
      level = Number(args.fromLevel ?? args.level ?? args[1] ?? 0);
      amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'SpilloverPaid': {
      orbitOwner = toLower(args.orbitOwner ?? args.from ?? args[0] ?? '');
      user = toLower(args.to ?? args.user ?? args[1] ?? '');
      level = Number(args.level ?? args[2] ?? 0);
      amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
      cycleNumber = await getCycleNumberFromResets();
      break;
    }

    case 'PositionActivationLinked': {
      orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
      level = Number(args.level ?? args[1] ?? 0);
      position = Number(args.position ?? args[2] ?? 0);
      cycleNumber = Number(args.cycleNumber ?? args[3] ?? 0);
      break;
    }

    case 'OrbitDependencyUpdated': {
      orbitOwner = toLower(args.oldAddress ?? args[1] ?? '');
      user = toLower(args.newAddress ?? args[2] ?? '');
      level = 0;
      cycleNumber = 0;
      break;
    }

    default:
      return;
  }

  if (!orbitOwner) {
    const message = '[ORBIT_EVENT_MISSING_OWNER]';
    console.error(message, {
      eventName,
      txHash: log.transactionHash,
      logIndex: log.index,
      args,
    });
    throw new Error(
      `${message} ${eventName} ${log.transactionHash}:${log.index}`
    );
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

export async function saveTokenLog(chainId, tokenSymbol, log, parsed, block) {
  const args = parsed.args || {};
  const user = toLower(args.to || args.from || args.user || '');
  const reason = String(args.reason || '');

  function extractLevelFromReason(reasonValue) {
    const text = String(reasonValue || '');

    const colonMatch = text.match(/:(\d+)/);
    if (colonMatch) {
      const level = Number(colonMatch[1]);
      if (Number.isInteger(level) && level >= 1 && level <= 10) return level;
    }

    const levelMatch = text.match(/level\D*(\d+)/i);
    if (levelMatch) {
      const level = Number(levelMatch[1]);
      if (Number.isInteger(level) && level >= 1 && level <= 10) return level;
    }

    return 0;
  }

  async function findLevelFromSameTx() {
    const txHash = toLower(log.transactionHash);

    const registrationEvent = await IndexedRegistrationEvent.findOne({
      txHash,
      level: { $gte: 1, $lte: 10 },
    })
      .sort({ logIndex: -1 })
      .lean();

    if (registrationEvent?.level) {
      return Number(registrationEvent.level);
    }

    const receipt = await IndexedReceipt.findOne({
      txHash,
      level: { $gte: 1, $lte: 10 },
    })
      .sort({ logIndex: -1 })
      .lean();

    if (receipt?.level) {
      return Number(receipt.level);
    }

    const orbitEvent = await IndexedOrbitEvent.findOne({
      txHash,
      level: { $gte: 1, $lte: 10 },
    })
      .sort({ logIndex: -1 })
      .lean();

    if (orbitEvent?.level) {
      return Number(orbitEvent.level);
    }

    return 0;
  }

  let level = extractLevelFromReason(reason);

  if (!level) {
    level = await findLevelFromSameTx();
  }

  await IndexedTokenEvent.updateOne(
    { txHash: toLower(log.transactionHash), logIndex: log.index },
    {
      $setOnInsert: {
        chainId,
        tokenSymbol,
        eventName: parsed.name,
        txHash: toLower(log.transactionHash),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        userAddress: user,
        amount: stringifyBigInt(args.amount || 0),
        reason,
        level,
        timestamp: toDateFromSeconds(block.timestamp),
      },
    },
    { upsert: true }
  );

  notifyFromIndexedTokenEvent({
    chainId,
    tokenSymbol,
    eventName: parsed.name,
    txHash: toLower(log.transactionHash),
    logIndex: log.index,
    blockNumber: log.blockNumber,
    userAddress: user,
    amount: stringifyBigInt(args.amount || 0),
    reason,
    level,
  }).catch((error) => {
    console.error('[NOTIFICATION_TOKEN_FAILED]', error?.message || String(error));
  });

  logDebug('[SAVED_TOKEN_EVENT]', {
    token: tokenSymbol,
    eventName: parsed.name,
    user,
    reason,
    level,
    txHash: toLower(log.transactionHash),
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

  const orderedLogs = [...logs].sort((a, b) => {
    const blockDelta = Number(a.blockNumber || 0) - Number(b.blockNumber || 0);
    if (blockDelta !== 0) return blockDelta;
    return Number(a.index ?? a.logIndex ?? 0) - Number(b.index ?? b.logIndex ?? 0);
  });

  for (const log of orderedLogs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch (error) {
      const message = '[PARSE_LOG_FAILED]';
      console.error(message, {
        contractKey,
        contractAddress,
        txHash: log.transactionHash,
        logIndex: log.index,
        topic0: log.topics?.[0],
        error: error?.message || String(error),
      });
      throw new Error(
        `${message} ${contractKey} ${log.transactionHash}:${log.index} ${error?.message || String(error)}`
      );
    }

    if (!parsed) {
      throw new Error(
        `[PARSE_LOG_EMPTY] ${contractKey} ${log.transactionHash}:${log.index}`
      );
    }

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
      throw new Error(
        `[MISSING_BLOCK_FOR_LOG] ${contractKey} ${log.transactionHash}:${log.index} block ${log.blockNumber}`
      );
    }

    if (['fgtToken', 'fgtrToken'].includes(contractKey)) {
      if (['UtilityMinted', 'UtilityBurned', 'UtilityLocked'].includes(parsed.name)) {
        const symbol = contractKey === 'fgtToken' ? 'FGT' : 'FGTr';
        await saveTokenLog(chainId, symbol, log, parsed, block);
        continue;
      }
    }

    if (
      contractKey === 'freedomTokenController' &&
      parsed.name === 'TokenRewardEligibility'
    ) {
      await saveFinancialEventLog(chainId, contractAddress, log, parsed, block);
      continue;
    }

    if (
      contractKey === 'registration' &&
      ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
    ) {
      await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
      continue;
    }

    if (contractKey === 'levelManager') {

      if (parsed.name === 'FounderRepActivated') {
        await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
        continue;
      }
      
      if (parsed.name === 'DetailedPayoutReceiptRecorded') {
        await saveReceiptLog(chainId, log, parsed, block);
        continue;
      }

      if (parsed.name === 'ActivationFinancialSummaryRecorded') {
        await saveActivationSummaryLog(chainId, log, parsed, block);
        continue;
      }

      if (
        [
          'PayoutNotDelivered',
          'RecycleCompletedDetailed',
          'AutoUpgradeCompleted',
          'FounderDistributionDetailed',
          'SystemChargeDistributedDetailed',
        ].includes(parsed.name)
      ) {
        await saveFinancialEventLog(chainId, contractAddress, log, parsed, block);
        continue;
      }
    }

    if (
      contractKey === 'autoUpgradeEscrow' &&
      ['EscrowLocked', 'EscrowUsedForUpgrade', 'EscrowReleasedToUser'].includes(parsed.name)
    ) {
      await saveEscrowLog(chainId, contractAddress, log, parsed, block);
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
        'PositionActivationLinked',
        'OrbitDependencyUpdated',
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
      key: 'autoUpgradeEscrow',
      contract: contracts.autoUpgradeEscrow || contracts.escrow,
      address: (contracts.autoUpgradeEscrow || contracts.escrow).target,
      startBlock: starts.autoUpgradeEscrow ?? starts.escrow ?? starts.levelManager,
      orbitType: null,
      chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
      priority: 3,
    },
    {
      key: 'p4Orbit',
      contract: contracts.p4Orbit,
      address: contracts.p4Orbit.target,
      startBlock: starts.p4Orbit,
      orbitType: 'P4',
      chunkSize: getTargetChunkSize('p4Orbit', sync.chunkSize),
      priority: 4,
    },
    {
      key: 'p12Orbit',
      contract: contracts.p12Orbit,
      address: contracts.p12Orbit.target,
      startBlock: starts.p12Orbit,
      orbitType: 'P12',
      chunkSize: getTargetChunkSize('p12Orbit', sync.chunkSize),
      priority: 5,
    },
    {
      key: 'p39Orbit',
      contract: contracts.p39Orbit,
      address: contracts.p39Orbit.target,
      startBlock: starts.p39Orbit,
      orbitType: 'P39',
      chunkSize: getTargetChunkSize('p39Orbit', sync.chunkSize),
      priority: 6,
    },
    {
      key: 'fgtToken',
      contract: contracts.fgtToken,
      address: contracts.fgtToken.target,
      startBlock: starts.fgtToken ?? starts.registration,
      orbitType: null,
      chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
      priority: 7,
    },
    {
      key: 'fgtrToken',
      contract: contracts.fgtrToken,
      address: contracts.fgtrToken.target,
      startBlock: starts.fgtrToken ?? starts.registration,
      orbitType: null,
      chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
      priority: 8,
    },
    {
      key: 'freedomTokenController',
      contract: contracts.freedomTokenController,
      address: contracts.freedomTokenController?.target,
      startBlock: starts.freedomTokenController ?? starts.fgtToken ?? starts.registration,
      orbitType: null,
      chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
      priority: 9,
    },
  ].filter((target) => target.contract && target.address);
}

function buildSyncStateSet(payload) {
  const set = { ...payload };

  if (payload?.meta && typeof payload.meta === 'object') {
    delete set.meta;

    Object.entries(payload.meta).forEach(([key, value]) => {
      set[`meta.${key}`] = value;
    });
  }

  return set;
}

async function updateSyncState(targetKey, payload, options = {}) {
  const filter = { key: targetKey };
  const ownerId = options.ownerId || indexerOwnerId;
  const requireOwner = Boolean(options.requireOwner);
  const update = { $set: buildSyncStateSet(payload) };

  if (options.unset) {
    update.$unset = Array.isArray(options.unset)
      ? Object.fromEntries(options.unset.map((key) => [key, '']))
      : options.unset;
  }

  if (requireOwner) {
    filter['meta.lease.ownerId'] = ownerId;
  }

  const result = await SyncState.updateOne(
    filter,
    update,
    { upsert: !requireOwner }
  );

  if (requireOwner && getUpdateMatchedCount(result) === 0) {
    throw new Error(
      `[INDEXER_LEASE_LOST] ${targetKey} cursor/status update rejected for ${ownerId}`
    );
  }

  return result;
}

async function markTargetIdle(targetKey, safeBlock, lastProcessedBlock, options = {}) {
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
  }, options);
}

async function processTargetChunk({ chainId, safeBlock, target }) {
  const state = await acquireTargetLease(target);

  if (!state) {
    return {
      key: target.key,
      status: 'leased',
      processed: false,
      safeBlock,
      lastProcessedBlock: 0,
      lagBlocks: 0,
    };
  }

  const ownedUpdate = {
    requireOwner: true,
    ownerId: indexerOwnerId,
  };

  let fromBlock = Number(state.lastProcessedBlock || 0) + 1;
  if (fromBlock === 1 && target.startBlock > 0) {
    fromBlock = target.startBlock;
  }

  if (fromBlock > safeBlock) {
    await markTargetIdle(target.key, safeBlock, state.lastProcessedBlock, ownedUpdate);
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
    }, ownedUpdate);

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
    await assertLeaseOwned(target.key);

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
    }, ownedUpdate);

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
      await assertLeaseOwned(target.key);

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
      }, {
        ...ownedUpdate,
        unset: ['meta.gapFrom', 'meta.gapTo', 'meta.retryRequired'],
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
      await recordIndexerGap({
        targetKey: target.key,
        fromBlock,
        toBlock,
        reason: buildErrorMessage(error),
        error,
      });

      await updateSyncState(target.key, {
        status: 'gap',
        errorMessage: buildErrorMessage(error),
        meta: {
          gapFrom: fromBlock,
          gapTo: toBlock,
          retryRequired: true,
        },
      }, ownedUpdate);
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
        }, ownedUpdate);

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
        }, ownedUpdate);

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
      }, ownedUpdate);

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
  const state = await acquireTargetLease(target);

  if (!state) {
    return {
      key: target.key,
      processed: false,
      fromBlock: null,
      toBlock: null,
      logCount: 0,
      leased: true,
    };
  }

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
      await assertLeaseOwned(target.key);

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

async function getReplayTargetContext(targetKey) {
  const context = await buildIndexerContext();
  const target = context.targets.find((item) => item.key === targetKey);

  if (!target) {
    throw new Error(`[UNKNOWN_INDEXER_TARGET] ${targetKey}`);
  }

  return {
    ...context,
    target,
  };
}

export async function replayIndexerRange({
  targetKey,
  fromBlock,
  toBlock,
  reason = 'manual replay',
  processRole = 'worker',
} = {}) {
  ensureIndexerOwner(processRole);

  const range = normalizeBlockRange(fromBlock, toBlock);
  const { target, chainId, sync } = await getReplayTargetContext(targetKey);
  const gapKey = await recordIndexerGap({
    targetKey,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
    reason,
  });

  await markGapReplayAttempt(gapKey, 'replaying');

  let totalLogs = 0;
  const replayChunkSize = Math.max(1, Number(sync.replayChunkSize || 100));
  let currentFrom = range.fromBlock;

  try {
    while (currentFrom <= range.toBlock) {
      const currentTo = Math.min(currentFrom + replayChunkSize - 1, range.toBlock);

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
    }

    await markGapResolved(gapKey);

    return {
      ok: true,
      gapKey,
      targetKey,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      logCount: totalLogs,
    };
  } catch (error) {
    await markGapReplayFailed(gapKey, error);
    throw error;
  }
}

export async function replayOpenGaps({
  targetKey = null,
  limit = 10,
  processRole = 'worker',
} = {}) {
  ensureIndexerOwner(processRole);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const query = {
    status: { $in: ['open', 'failed'] },
  };

  if (targetKey) {
    query.targetKey = targetKey;
  }

  const gaps = await IndexerGap.find(query)
    .sort({ firstDetectedAt: 1 })
    .limit(safeLimit)
    .lean();

  const results = [];

  for (const gap of gaps) {
    try {
      const result = await replayIndexerRange({
        targetKey: gap.targetKey,
        fromBlock: gap.fromBlock,
        toBlock: gap.toBlock,
        reason: `open gap replay: ${gap.reason || gap.gapKey}`,
        processRole,
      });
      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        gapKey: gap.gapKey,
        targetKey: gap.targetKey,
        fromBlock: gap.fromBlock,
        toBlock: gap.toBlock,
        error: buildErrorMessage(error),
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    count: results.length,
    results,
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

export async function startIndexer(options = {}) {
  const { pollIntervalMs } = getSyncConfig();

  if (isRunning) return runnerPromise;

  ensureIndexerOwner(options.processRole || 'server');

  isRunning = true;
  stopRequested = false;
  pendingImmediatePass = false;
  latestObservedBlock = 0;

  await ensureRealtimeProviders().catch((error) => {
    console.error('[INDEXER_REALTIME_BOOTSTRAP_ERROR]', buildErrorMessage(error));
  });

  startRealtimeBlockSubscription();

  runnerPromise = (async () => {
    try {
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
    } finally {
      if (immediatePassTimer) {
        clearTimeout(immediatePassTimer);
        immediatePassTimer = null;
      }

      stopRealtimeBlockSubscription();

      await releaseOwnedLeases('indexer-stopped').catch((error) => {
        console.error('[INDEXER_LEASE_RELEASE_ERROR]', buildErrorMessage(error));
      });

      isRunning = false;
      runnerPromise = null;
      passInFlightPromise = null;
      pendingImmediatePass = false;
    }
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

  if (runnerPromise) {
    return runnerPromise;
  }

  return releaseOwnedLeases('stop-requested').catch((error) => {
    console.error('[INDEXER_LEASE_RELEASE_ERROR]', buildErrorMessage(error));
  });
}

















// import SyncState from '../models/SyncState.js';
// import IndexedReceipt from '../models/IndexedReceipt.js';
// import IndexedOrbitEvent from '../models/IndexedOrbitEvent.js';
// import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js';
// import IndexedTokenEvent from '../models/IndexedTokenEvent.js'; 
// import {
//   safeRpcCall,
//   getProviderHealthSnapshot,
//   ensureRealtimeProviders,
//   onNewBlock,
// } from '../blockchain/provider.js';
// import { getContracts } from '../blockchain/contracts.js';
// import { getStartBlocks, getSyncConfig } from '../config/syncConfig.js';
// import env from '../config/env.js';

// function buildErrorMessage(error) {
//   return (
//     String(error?.error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.message || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '')
//   ).trim();
// }

// function isBlockRangeLimitError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('eth_getlogs requests with up to a 10 block range') ||
//     lower.includes('block range should work') ||
//     lower.includes('limited to a 5 range') ||
//     lower.includes('requested block range exceeds the limits') ||
//     lower.includes('block range exceeds configured limit')
//   );
// }

// function isRateLimitError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

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

// function isOutOfCreditsError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('402') ||
//     lower.includes('payment required') ||
//     lower.includes('out of cu') ||
//     lower.includes('out of credits') ||
//     lower.includes('billing') ||
//     lower.includes('quota exceeded') ||
//     lower.includes('upgrade required')
//   );
// }

// function isDebugLoggingEnabled() {
//   return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
// }

// function logDebug(...args) {
//   if (isDebugLoggingEnabled()) {
//     console.log(...args);
//   }
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
// const LIVE_TAIL_WINDOW_BLOCKS =20;
// const LIVE_TAIL_TARGET_KEYS = new Set([
//   'registration',
//   'levelManager',
//   'p4Orbit',
//   'p12Orbit',
//   'p39Orbit',
//   'fgtToken',
//   'fgtrToken'
// ]);
// const LIVE_TAIL_EVERY_N_PASSES = 5;
// const LIVE_TAIL_MAX_CHUNK_SIZE = 3;
// const INTER_TARGET_DELAY_MS = 0;
// const IMMEDIATE_PASS_DEBOUNCE_MS = 50;

// let passCounter = 0;

// let isRunning = false;
// let stopRequested = false;
// let runnerPromise = null;

// let passInFlightPromise = null;
// let pendingImmediatePass = false;
// let immediatePassTimer = null;
// let unsubscribeNewBlock = null;
// let latestObservedBlock = 0;

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

// export async function getBlockCached(blockNumber) {
//   const key = Number(blockNumber);

//   if (blockCache.has(key)) {
//     return blockCache.get(key);
//   }

//   const block = await safeRpcCall((provider) =>
//     provider.getBlock(blockNumber)
//   ).catch((error) => {
//     logDebug('[BLOCK_FETCH_FAILED]', {
//       blockNumber,
//       error: buildErrorMessage(error),
//     });
//     return null;
//   });

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

// export async function saveReceiptLog(chainId, log, parsed, block) {
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

//   logDebug('[SAVED_RECEIPT]', {
//     txHash: toLower(log.transactionHash),
//     logIndex: log.index,
//     eventName: parsed.name,
//     orbitOwner: toLower(args.orbitOwner),
//     receiver: toLower(args.receiver),
//     blockNumber: log.blockNumber,
//   });
// }

// export async function saveRegistrationLog(chainId, contractAddress, log, parsed, block) {
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

//   logDebug('[SAVED_REGISTRATION_EVENT]', {
//     txHash: toLower(log.transactionHash),
//     logIndex: log.index,
//     eventName: parsed.name,
//     user: toLower(args.user || ''),
//     referrer: toLower(args.referrer || ''),
//     level: Number(args.level || 0),
//     blockNumber: log.blockNumber,
//   });
// }

// export async function saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block) {
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

//   // Helper function to get cycle number from latest reset before this log
//   async function getCycleNumberFromResets() {
//     const latestReset = await IndexedOrbitEvent.findOne({
//       orbitType,
//       orbitOwner,
//       level,
//       eventName: 'OrbitReset',
//       $or: [
//         { blockNumber: { $lt: log.blockNumber } },
//         {
//           blockNumber: log.blockNumber,
//           logIndex: { $lt: log.index },
//         },
//       ],
//     })
//       .sort({ blockNumber: -1, logIndex: -1 })
//       .lean();

//     return latestReset ? Number(latestReset.cycleNumber || 0) + 1 : 1;
//   }

//   switch (eventName) {
//     case 'PositionFilled': {
//       orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
//       user = toLower(args.user ?? args[1] ?? '');
//       level = Number(args.level ?? args[2] ?? 0);
//       position = Number(args.position ?? args[3] ?? 0);
//       amount = stringifyBigInt(args.amount ?? args[4] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     case 'OrbitReset': {
//       orbitOwner = toLower(args.user ?? '');
//       level = Number(args.level ?? 0);
//       cycleNumber = Number(args.cycleNumber ?? 0);

//       if (!orbitOwner) {
//         console.warn('[ORBIT_RESET_MISSING_USER]', {
//           txHash: log.transactionHash,
//           logIndex: log.index,
//           eventName,
//           args,
//         });
//         return;
//       }
//       break;
//     }

//     case 'LinePaymentTracked': {
//       orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
//       level = Number(args.level ?? args[1] ?? 0);
//       line = Number(args.line ?? args[2] ?? 0);
//       linePaymentNumber = Number(args.linePaymentNumber ?? args[3] ?? 0);
//       position = Number(args.position ?? args[4] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     case 'PaymentRuleApplied': {
//       orbitOwner = toLower(args.orbitOwner ?? args[0] ?? '');
//       level = Number(args.level ?? args[1] ?? 0);
//       position = Number(args.position ?? args[2] ?? 0);
//       line = Number(args.line ?? args[3] ?? 0);
//       linePaymentNumber = Number(args.linePaymentNumber ?? args[4] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     case 'EscrowUpdated': {
//       orbitOwner = toLower(args.orbitOwner ?? args.user ?? args[0] ?? '');
//       level = Number(args.level ?? args[1] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     case 'AutoUpgradeTriggered': {
//       orbitOwner = toLower(args.user ?? args[0] ?? '');
//       level = Number(args.fromLevel ?? args.level ?? args[1] ?? 0);
//       amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     case 'SpilloverPaid': {
//       orbitOwner = toLower(args.orbitOwner ?? args.from ?? args[0] ?? '');
//       user = toLower(args.to ?? args.user ?? args[1] ?? '');
//       level = Number(args.level ?? args[2] ?? 0);
//       amount = stringifyBigInt(args.amount ?? args[3] ?? 0);
//       cycleNumber = await getCycleNumberFromResets();
//       break;
//     }

//     default:
//       return;
//   }

//   if (!orbitOwner) {
//     console.warn('[ORBIT_EVENT_MISSING_OWNER]', {
//       eventName,
//       txHash: log.transactionHash,
//       logIndex: log.index,
//       args,
//     });
//     return;
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

//   logDebug('[SAVED_ORBIT_EVENT]', {
//     txHash: toLower(log.transactionHash),
//     logIndex: log.index,
//     eventName,
//     orbitType,
//     orbitOwner,
//     user,
//     level,
//     position,
//     cycleNumber,
//     blockNumber: log.blockNumber,
//   });
// }

// // export async function saveTokenLog(chainId, tokenSymbol, log, parsed, block) {
// //   const args = parsed.args || {};
// //   const user = toLower(args.to || args.from || args.user || '');
// //   const reason = args.reason || '';

// //   // EXTRACTION LOGIC: Pull level from the reason string (e.g., "manualActivation:2")
// //   let level = 0;
// //   if (reason.includes(':')) {
// //     const parts = reason.split(':');
// //     level = Number(parts[1]) || 0;
// //   }

// //   await IndexedTokenEvent.updateOne(
// //     { txHash: toLower(log.transactionHash), logIndex: log.index },
// //     {
// //       $setOnInsert: {
// //         chainId,
// //         tokenSymbol,
// //         eventName: parsed.name,
// //         txHash: toLower(log.transactionHash),
// //         logIndex: log.index,
// //         blockNumber: log.blockNumber,
// //         userAddress: user,
// //         amount: stringifyBigInt(args.amount || 0),
// //         reason: reason, // Stores the full string like "manualActivation:2"
// //         level: level,  // New field to make filtering easy
// //         timestamp: toDateFromSeconds(block.timestamp),
// //       },
// //     },
// //     { upsert: true }
// //   );

// //     logDebug('[SAVED_TOKEN_EVENT]', {
// //     token: tokenSymbol,
// //     eventName: parsed.name,
// //     user,
// //     txHash: toLower(log.transactionHash)
// //   });
// // }




// export async function saveTokenLog(chainId, tokenSymbol, log, parsed, block) {
//   const args = parsed.args || {};
//   const user = toLower(args.to || args.from || args.user || '');
//   const reason = String(args.reason || '');

//   function extractLevelFromReason(reasonValue) {
//     const text = String(reasonValue || '');

//     const colonMatch = text.match(/:(\d+)/);
//     if (colonMatch) {
//       const level = Number(colonMatch[1]);
//       if (Number.isInteger(level) && level >= 1 && level <= 10) return level;
//     }

//     const levelMatch = text.match(/level\D*(\d+)/i);
//     if (levelMatch) {
//       const level = Number(levelMatch[1]);
//       if (Number.isInteger(level) && level >= 1 && level <= 10) return level;
//     }

//     return 0;
//   }

//   async function findLevelFromSameTx() {
//     const txHash = toLower(log.transactionHash);

//     const registrationEvent = await IndexedRegistrationEvent.findOne({
//       txHash,
//       level: { $gte: 1, $lte: 10 },
//     })
//       .sort({ logIndex: -1 })
//       .lean();

//     if (registrationEvent?.level) {
//       return Number(registrationEvent.level);
//     }

//     const receipt = await IndexedReceipt.findOne({
//       txHash,
//       level: { $gte: 1, $lte: 10 },
//     })
//       .sort({ logIndex: -1 })
//       .lean();

//     if (receipt?.level) {
//       return Number(receipt.level);
//     }

//     const orbitEvent = await IndexedOrbitEvent.findOne({
//       txHash,
//       level: { $gte: 1, $lte: 10 },
//     })
//       .sort({ logIndex: -1 })
//       .lean();

//     if (orbitEvent?.level) {
//       return Number(orbitEvent.level);
//     }

//     return 0;
//   }

//   let level = extractLevelFromReason(reason);

//   if (!level) {
//     level = await findLevelFromSameTx();
//   }

//   await IndexedTokenEvent.updateOne(
//     { txHash: toLower(log.transactionHash), logIndex: log.index },
//     {
//       $setOnInsert: {
//         chainId,
//         tokenSymbol,
//         eventName: parsed.name,
//         txHash: toLower(log.transactionHash),
//         logIndex: log.index,
//         blockNumber: log.blockNumber,
//         userAddress: user,
//         amount: stringifyBigInt(args.amount || 0),
//         reason,
//         level,
//         timestamp: toDateFromSeconds(block.timestamp),
//       },
//     },
//     { upsert: true }
//   );

//   logDebug('[SAVED_TOKEN_EVENT]', {
//     token: tokenSymbol,
//     eventName: parsed.name,
//     user,
//     reason,
//     level,
//     txHash: toLower(log.transactionHash),
//   });
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

//   // logDebug('[GET_LOGS_RESULT]', {
//   //   contractKey,
//   //   contractAddress,
//   //   fromBlock,
//   //   toBlock,
//   //   count: logs.length,
//   // });

//   for (const log of logs) {
//     let parsed;
//     try {
//       parsed = contract.interface.parseLog(log);
//     } catch (error) {
//       console.error('[PARSE_LOG_FAILED]', {
//         contractKey,
//         contractAddress,
//         txHash: log.transactionHash,
//         logIndex: log.index,
//         topic0: log.topics?.[0],
//         error: error?.message || String(error),
//       });
//       continue;
//     }

//     if (!parsed) continue;

//     logDebug('[PARSED_LOG]', {
//       contractKey,
//       contractAddress,
//       eventName: parsed.name,
//       txHash: log.transactionHash,
//       logIndex: log.index,
//       blockNumber: log.blockNumber,
//     });

//     const block = await getBlockCached(log.blockNumber);
//     // if (!block) {
//     //   console.warn('[MISSING_BLOCK_FOR_LOG]', {
//     //     contractKey,
//     //     contractAddress,
//     //     txHash: log.transactionHash,
//     //     logIndex: log.index,
//     //     blockNumber: log.blockNumber,
//     //   });
//     //   continue;
//     // }

//     if (!block) {
//       throw new Error(
//         `[MISSING_BLOCK_FOR_LOG] ${contractKey} ${log.transactionHash}:${log.index} block ${log.blockNumber}`
//       );
//     }

//     if (['fgtToken', 'fgtrToken'].includes(contractKey)) {
//       if (['UtilityMinted', 'UtilityBurned', 'UtilityLocked'].includes(parsed.name)) {
//         const symbol = contractKey === 'fgtToken' ? 'FGT' : 'FGTr';
//         await saveTokenLog(chainId, symbol, log, parsed, block);
//         continue;
//       }
//     }

//     if (
//       contractKey === 'registration' &&
//       ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
//     ) {
//       await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
//       continue;
//     }

//     if (
//       contractKey === 'levelManager' &&
//       parsed.name === 'DetailedPayoutReceiptRecorded'
//     ) {
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
//     {
//       key: 'fgtToken',
//       contract: contracts.fgtToken,
//       address: contracts.fgtToken.target,
//       startBlock: starts.fgtToken ?? starts.registration,
//       orbitType: null,
//       chunkSize: getTargetChunkSize('levelManager', sync.chunkSize), // Use levelManager size as a safe base
//       priority: 6,
//     },
//     {
//       key: 'fgtrToken',
//       contract: contracts.fgtrToken,
//       address: contracts.fgtrToken.target,
//       startBlock: starts.fgtrToken ?? starts.registration,
//       orbitType: null,
//       chunkSize: getTargetChunkSize('levelManager', sync.chunkSize),
//       priority: 7,
//     },
//   ];
// }

// async function updateSyncState(targetKey, payload) {
//   await SyncState.updateOne(
//     { key: targetKey },
//     { $set: payload },
//     { upsert: true }
//   );
// }

// async function markTargetIdle(targetKey, safeBlock, lastProcessedBlock) {
//   const lagBlocks = Math.max(0, Number(safeBlock) - Number(lastProcessedBlock || 0));

//   await updateSyncState(targetKey, {
//     status: 'idle',
//     lastSyncedAt: new Date(),
//     errorMessage: '',
//     meta: {
//       safeBlock,
//       lagBlocks,
//       lastChunkFrom: null,
//       lastChunkTo: null,
//       retryHint: '',
//       coolingDown: false,
//       providerHealth: getProviderHealthSnapshot(),
//     },
//   });
// }

// async function processTargetChunk({ chainId, safeBlock, target }) {
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

//     await updateSyncState(target.key, {
//       status: 'cooldown',
//       errorMessage: '',
//       meta: {
//         safeBlock,
//         lagBlocks,
//         lastChunkFrom: null,
//         lastChunkTo: null,
//         retryHint: 'Cooling down after RPC issue',
//         coolingDown: true,
//         providerHealth: getProviderHealthSnapshot(),
//       },
//     });

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

//     await updateSyncState(target.key, {
//       status: 'running',
//       errorMessage: '',
//       meta: {
//         safeBlock,
//         lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//         lastChunkFrom: fromBlock,
//         lastChunkTo: toBlock,
//         retryHint: '',
//         coolingDown: false,
//         providerHealth: getProviderHealthSnapshot(),
//       },
//     });

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

//       await updateSyncState(target.key, {
//         lastProcessedBlock: toBlock,
//         status: toBlock >= safeBlock ? 'idle' : 'running',
//         lastSyncedAt: new Date(),
//         errorMessage: '',
//         meta: {
//           safeBlock,
//           lagBlocks: newLagBlocks,
//           lastChunkFrom: fromBlock,
//           lastChunkTo: toBlock,
//           lastChunkDurationMs: Date.now() - startedAt,
//           lastChunkLogCount: logCount,
//           retryHint: '',
//           coolingDown: false,
//           providerHealth: getProviderHealthSnapshot(),
//         },
//       });

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

//       console.error('[INDEXER_CHUNK_ERROR]', {
//         target: target.key,
//         address: target.address,
//         fromBlock,
//         toBlock,
//         chunkSize,
//         attempt,
//         message: buildErrorMessage(error),
//       });

//       // GAP DETECTION
//       await updateSyncState(target.key, {
//         status: 'gap',
//         errorMessage: buildErrorMessage(error),
//         meta: {
//           gapFrom: fromBlock,
//           gapTo: toBlock,
//           retryRequired: true,
//         },
//       });
//       setTargetBackoff(target.key, 2000);

//       if (isBlockRangeLimitError(error) && chunkSize > 1) {
//         chunkSize = Math.max(1, Math.floor(chunkSize / 2));

//         await updateSyncState(target.key, {
//           status: 'running',
//           errorMessage: '',
//           meta: {
//             safeBlock,
//             lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//             lastChunkFrom: fromBlock,
//             lastChunkTo: toBlock,
//             retryHint: `Reducing chunk size to ${chunkSize}`,
//             coolingDown: false,
//             providerHealth: getProviderHealthSnapshot(),
//           },
//         });

//         continue;
//       }

//       if (isRateLimitError(error) || isOutOfCreditsError(error)) {
//         const cooldownMs = isOutOfCreditsError(error)
//           ? Math.max(15000, Number(env.RPC_OUT_OF_CREDITS_COOLDOWN_MS) || 15000)
//           : Math.min(1500 * attempt, 6000);

//         setTargetBackoff(target.key, cooldownMs);

//         await updateSyncState(target.key, {
//           status: 'cooldown',
//           errorMessage: '',
//           meta: {
//             safeBlock,
//             lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//             lastChunkFrom: fromBlock,
//             lastChunkTo: toBlock,
//             retryHint: isOutOfCreditsError(error)
//               ? `RPC provider out of credits; cooling down for ${cooldownMs}ms`
//               : `Rate-limited; cooling down for ${cooldownMs}ms`,
//             coolingDown: true,
//             providerHealth: getProviderHealthSnapshot(),
//           },
//         });

//         return {
//           key: target.key,
//           status: 'cooldown',
//           processed: false,
//           safeBlock,
//           lastProcessedBlock: state.lastProcessedBlock,
//           lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//         };
//       }

//       await updateSyncState(target.key, {
//         status: 'error',
//         errorMessage: error.message || 'Unknown sync error',
//         meta: {
//           safeBlock,
//           lagBlocks: Math.max(0, safeBlock - Number(state.lastProcessedBlock || 0)),
//           lastChunkFrom: fromBlock,
//           lastChunkTo: toBlock,
//           retryHint: '',
//           coolingDown: false,
//           providerHealth: getProviderHealthSnapshot(),
//         },
//       });

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

// async function processLiveTailTarget({ chainId, latestBlock, target }) {
//   const tailWindowStart = Math.max(
//     Number(target.startBlock || 0),
//     Math.max(0, latestBlock - LIVE_TAIL_WINDOW_BLOCKS + 1)
//   );

//   if (tailWindowStart > latestBlock) {
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
//   let chunkSize = Math.max(1, Math.min(target.chunkSize, LIVE_TAIL_MAX_CHUNK_SIZE));
//   let rateLimited = false;

//   while (currentFrom <= latestBlock) {
//     const currentTo = Math.min(currentFrom + chunkSize - 1, latestBlock);

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

//       if (INTER_TARGET_DELAY_MS > 0) {
//         await sleep(INTER_TARGET_DELAY_MS);
//       }
//     } catch (error) {
//       console.error('[LIVE_TAIL_ERROR]', {
//         target: target.key,
//         address: target.address,
//         fromBlock: currentFrom,
//         toBlock: currentTo,
//         chunkSize,
//         message: buildErrorMessage(error),
//       });

//       if (isBlockRangeLimitError(error) && chunkSize > 1) {
//         chunkSize = Math.max(1, Math.floor(chunkSize / 2));
//         continue;
//       }

//       // if (isRateLimitError(error) || isOutOfCreditsError(error)) {
//       //   rateLimited = true;
//       //   const cooldownMs = isOutOfCreditsError(error)
//       //     ? Math.max(15000, Number(env.RPC_OUT_OF_CREDITS_COOLDOWN_MS) || 15000)
//       //     : 3000;

//       //   setTargetBackoff(target.key, cooldownMs);
//       //   break;
//       // }


//       if (isRateLimitError(error) || isOutOfCreditsError(error)) {
//         rateLimited = true;
//         break;
//       }
//       break;
//     }
//   }

//   return {
//     key: target.key,
//     processed: !rateLimited,
//     fromBlock: tailWindowStart,
//     toBlock: latestBlock,
//     logCount: totalLogs,
//     rateLimited,
//   };
// }

// async function runLiveTailSync({ chainId, latestBlock, targets }) {
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

//   const results = await Promise.all(
//     liveTailTargets.map(async (target) => {
//       try {
//         return await processLiveTailTarget({
//           chainId,
//           latestBlock,
//           target,
//         });
//       } catch (error) {
//         console.error('[LIVE_TAIL_TARGET_ERROR]', {
//           target: target.key,
//           message: buildErrorMessage(error),
//         });

//         return {
//           key: target.key,
//           processed: false,
//           fromBlock: null,
//           toBlock: null,
//           logCount: 0,
//           rateLimited: false,
//           error: buildErrorMessage(error),
//         };
//       }
//     })
//   );

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

//   const targets = buildTargets(contracts, starts, sync).sort(
//     (a, b) => a.priority - b.priority
//   );

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
//   const ctx = context || (await buildIndexerContext());

//   let finalResults = [];
//   let stillBehind = true;

//   while (stillBehind) {
//     const results = await Promise.all(
//       ctx.targets.map(async (target) => {
//         try {
//           return await processTargetChunk({
//             chainId: ctx.chainId,
//             safeBlock: ctx.safeBlock,
//             target,
//           });
//         } catch (error) {
//           console.error('[INDEXER_TARGET_ERROR]', {
//             target: target.key,
//             message: buildErrorMessage(error),
//           });

//           return {
//             key: target.key,
//             status: 'error',
//             processed: false,
//             safeBlock: ctx.safeBlock,
//             lastProcessedBlock: 0,
//             lagBlocks: 0,
//             error: buildErrorMessage(error),
//           };
//         }
//       })
//     );

//     finalResults = results;

//     stillBehind = results.some(
//       (r) => r.processed && r.status !== 'idle'
//     );
//   }

//   return {
//     latestBlock: ctx.latestBlock,
//     safeBlock: ctx.safeBlock,
//     results: finalResults,
//   };
// }

// export async function runIndexerPass() {
//   blockCache.clear();
//   passCounter += 1;
//   const context = await buildIndexerContext();

//   const liveTail = await runLiveTailSync({
//     chainId: context.chainId,
//     latestBlock: context.latestBlock,
//     targets: context.targets,
//   });

//   const ordered = await runIndexerCycle(context);

//   const maxLag = ordered.results.reduce(
//     (max, item) => Math.max(max, Number(item?.lagBlocks || 0)),
//     0
//   );

//   if (String(env.LOG_LEVEL || '').toLowerCase() === 'debug' || maxLag > 0) {
//     console.log('[INDEXER_PASS_SUMMARY]', {
//       latestBlock: context.latestBlock,
//       safeBlock: context.safeBlock,
//       maxLag,
//       liveTailResults: liveTail.results?.length || 0,
//       orderedResults: ordered.results?.length || 0,
//       liveTailError: liveTail.error || '',
//       latestObservedBlock,
//     });
//   }

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

// async function runIndexerPassGuarded(reason = 'manual') {
//   if (passInFlightPromise) {
//     pendingImmediatePass = true;
//     logDebug('[INDEXER_PASS_COALESCED]', { reason });
//     return passInFlightPromise;
//   }

//   passInFlightPromise = (async () => {
//     try {
//       logDebug('[INDEXER_PASS_START]', { reason });
//       return await runIndexerPass();
//     } finally {
//       passInFlightPromise = null;

//       if (pendingImmediatePass && !stopRequested) {
//         pendingImmediatePass = false;

//         Promise.resolve()
//           .then(() => runIndexerPassGuarded('coalesced-follow-up'))
//           .catch((error) => {
//             console.error('[INDEXER_PASS_FOLLOW_UP_ERROR]', buildErrorMessage(error));
//           });
//       }
//     }
//   })();

//   return passInFlightPromise;
// }

// function scheduleImmediatePass(reason = 'block-event') {
//   pendingImmediatePass = true;

//   if (immediatePassTimer) {
//     clearTimeout(immediatePassTimer);
//     immediatePassTimer = null;
//   }

//   immediatePassTimer = setTimeout(() => {
//     immediatePassTimer = null;

//     if (stopRequested || !isRunning) {
//       return;
//     }

//     runIndexerPassGuarded(reason).catch((error) => {
//       console.error('[INDEXER_IMMEDIATE_PASS_ERROR]', buildErrorMessage(error));
//     });
//   }, IMMEDIATE_PASS_DEBOUNCE_MS);
// }

// function startRealtimeBlockSubscription() {
//   if (unsubscribeNewBlock) return;

//   unsubscribeNewBlock = onNewBlock((blockNumber) => {
//     latestObservedBlock = Math.max(latestObservedBlock, Number(blockNumber || 0));
//     logDebug('[INDEXER_NEW_BLOCK]', { blockNumber: Number(blockNumber || 0) });
//     scheduleImmediatePass('new-block');
//   });
// }

// function stopRealtimeBlockSubscription() {
//   if (typeof unsubscribeNewBlock === 'function') {
//     try {
//       unsubscribeNewBlock();
//     } catch {
//       // ignore
//     }
//   }

//   unsubscribeNewBlock = null;
// }

// export async function startIndexer() {
//   const { pollIntervalMs } = getSyncConfig();

//   if (isRunning) return runnerPromise;

//   isRunning = true;
//   stopRequested = false;
//   pendingImmediatePass = false;
//   latestObservedBlock = 0;

//   await ensureRealtimeProviders().catch((error) => {
//     console.error('[INDEXER_REALTIME_BOOTSTRAP_ERROR]', buildErrorMessage(error));
//   });

//   startRealtimeBlockSubscription();

//   runnerPromise = (async () => {
//     await runIndexerPassGuarded('startup');

//     while (!stopRequested) {
//       try {
//         await sleep(Math.max(500, pollIntervalMs));
//       } catch {
//         // ignore
//       }

//       if (stopRequested) break;

//       try {
//         await runIndexerPassGuarded('scheduled-poll');
//       } catch (error) {
//         console.error('[INDEXER_PASS_ERROR]', buildErrorMessage(error));

//         if (isRateLimitError(error) || isOutOfCreditsError(error)) {
//           await sleep(20000);
//         }
//       }
//     }

//     if (immediatePassTimer) {
//       clearTimeout(immediatePassTimer);
//       immediatePassTimer = null;
//     }

//     stopRealtimeBlockSubscription();

//     isRunning = false;
//     runnerPromise = null;
//     passInFlightPromise = null;
//     pendingImmediatePass = false;
//   })();

//   return runnerPromise;
// }

// export function stopIndexer() {
//   stopRequested = true;

//   if (immediatePassTimer) {
//     clearTimeout(immediatePassTimer);
//     immediatePassTimer = null;
//   }

//   stopRealtimeBlockSubscription();
// }
