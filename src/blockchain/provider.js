import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import env from '../config/env.js';

let httpProviderEntries = [];
let wsProviderEntries = [];
let httpProviderPointer = 0;
let wsProviderPointer = 0;

let activeRpcCalls = 0;
const waitQueue = [];

let wsBlockSubscriptionStarted = false;
const wsBlockListeners = new Set();
const wsProviderListeners = new Map();
let fallbackBlockPoller = null;
let lastBroadcastBlock = 0;

const DEFAULT_HTTP_RETRY_ATTEMPTS = 4;
const DEFAULT_HTTP_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_HTTP_MAX_CONCURRENCY = 8;
const DEFAULT_OUT_OF_CREDITS_COOLDOWN_MS = 120000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15000;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 6000;
const DEFAULT_WS_RECONNECT_BASE_DELAY_MS = 2000;
const DEFAULT_WS_RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_FALLBACK_POLL_INTERVAL_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function buildErrorMessage(error) {
  return (
    String(error?.error?.message || '') +
    ' ' +
    String(error?.message || '') +
    ' ' +
    String(error?.shortMessage || '') +
    ' ' +
    String(error?.info?.responseStatus || '') +
    ' ' +
    String(error?.info?.responseBody || '') +
    ' ' +
    String(error?.code || '')
  ).trim();
}

function isDebugLoggingEnabled() {
  return String(env.LOG_LEVEL || 'info').toLowerCase() === 'debug';
}

function logDebug(...args) {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
}

function getHttpRetryAttempts() {
  return Math.max(0, Number(env.RPC_RETRY_ATTEMPTS) || DEFAULT_HTTP_RETRY_ATTEMPTS);
}

function getHttpRetryBaseDelayMs() {
  return Math.max(100, Number(env.RPC_RETRY_BASE_DELAY_MS) || DEFAULT_HTTP_RETRY_BASE_DELAY_MS);
}

function getHttpMaxConcurrency() {
  return Math.max(1, Number(env.RPC_MAX_CONCURRENCY) || DEFAULT_HTTP_MAX_CONCURRENCY);
}

function getOutOfCreditsCooldownMs() {
  return Math.max(
    15000,
    Number(env.RPC_OUT_OF_CREDITS_COOLDOWN_MS) || DEFAULT_OUT_OF_CREDITS_COOLDOWN_MS
  );
}

function getRateLimitCooldownMs(failures = 1) {
  const configured = Number(env.RPC_RATE_LIMIT_COOLDOWN_MS) || DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  return Math.max(3000, Math.min(configured * Math.max(1, failures), 60000));
}

function getTransientCooldownMs(failures = 1) {
  const configured = Number(env.RPC_TRANSIENT_COOLDOWN_MS) || DEFAULT_TRANSIENT_COOLDOWN_MS;
  return Math.max(1000, Math.min(configured * Math.max(1, failures), 30000));
}

function getWsReconnectBaseDelayMs() {
  return Math.max(
    500,
    Number(env.WS_RECONNECT_BASE_DELAY_MS) || DEFAULT_WS_RECONNECT_BASE_DELAY_MS
  );
}

function getWsReconnectMaxDelayMs() {
  return Math.max(
    getWsReconnectBaseDelayMs(),
    Number(env.WS_RECONNECT_MAX_DELAY_MS) || DEFAULT_WS_RECONNECT_MAX_DELAY_MS
  );
}

function getFallbackPollIntervalMs() {
  return Math.max(
    1000,
    Number(env.WS_FALLBACK_POLL_INTERVAL_MS) || DEFAULT_FALLBACK_POLL_INTERVAL_MS
  );
}

function isRateLimitError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('429') ||
    lower.includes('1015') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('throughput') ||
    lower.includes('compute units per second') ||
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

function isTimeoutError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('request timeout') ||
    lower.includes('gateway timeout')
  );
}

function isNetworkError(error) {
  const lower = buildErrorMessage(error).toLowerCase();

  return (
    lower.includes('socket hang up') ||
    lower.includes('network error') ||
    lower.includes('failed to detect network') ||
    lower.includes('missing response') ||
    lower.includes('bad gateway') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('connection closed') ||
    lower.includes('websocket closed') ||
    lower.includes('server error')
  );
}

function isTransientRpcError(error) {
  return (
    isRateLimitError(error) ||
    isOutOfCreditsError(error) ||
    isTimeoutError(error) ||
    isNetworkError(error)
  );
}

function buildHttpEntry(url, index) {
  return {
    id: `rpc-${index + 1}`,
    url,
    provider: new JsonRpcProvider(
      url,
      {
        chainId: env.CHAIN_ID,
        name: `chain-${env.CHAIN_ID}`,
      },
      {
        staticNetwork: true,
      }
    ),
    failures: 0,
    cooldownUntil: 0,
    lastError: '',
    successCount: 0,
    lastSuccessAt: 0,
    lastUsedAt: 0,
  };
}

function buildWsEntry(url, index) {
  return {
    id: `ws-${index + 1}`,
    url,
    provider: null,
    failures: 0,
    cooldownUntil: 0,
    lastError: '',
    successCount: 0,
    reconnectAttempt: 0,
    reconnectTimer: null,
    connected: false,
    lastConnectedAt: 0,
    lastBlockAt: 0,
    lastBlockNumber: 0,
    lastUsedAt: 0,
    providerInstanceId: 0,
  };
}

function initProviders() {
  if (httpProviderEntries.length === 0) {
    const rpcUrls = toArray(env.RPC_URLS);

    if (rpcUrls.length === 0) {
      throw new Error('RPC_URLS is not configured');
    }

    httpProviderEntries = rpcUrls.map((url, index) => buildHttpEntry(url, index));
  }

  if (wsProviderEntries.length === 0) {
    const wsUrls = toArray(env.WS_RPC_URLS);

    wsProviderEntries = wsUrls.map((url, index) => buildWsEntry(url, index));
  }

  return {
    http: httpProviderEntries,
    ws: wsProviderEntries,
  };
}

function getHealthyHttpProviderEntries() {
  initProviders();
  const now = Date.now();

  const healthy = httpProviderEntries.filter(
    (entry) => entry.cooldownUntil <= now
  );

  return healthy.length > 0 ? healthy : httpProviderEntries;
}

function pickNextHttpProviderEntry() {
  const healthy = getHealthyHttpProviderEntries();

  healthy.sort((a, b) => {
    if (a.failures !== b.failures) return a.failures - b.failures;
    if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
    return a.lastUsedAt - b.lastUsedAt;
  });

  const entry = healthy[httpProviderPointer % healthy.length];
  httpProviderPointer = (httpProviderPointer + 1) % Number.MAX_SAFE_INTEGER;
  entry.lastUsedAt = Date.now();

  return entry;
}

function getHealthyWsProviderEntries() {
  initProviders();
  const now = Date.now();

  const healthy = wsProviderEntries.filter(
    (entry) => entry.cooldownUntil <= now
  );

  return healthy.length > 0 ? healthy : wsProviderEntries;
}

function pickNextWsProviderEntry() {
  const healthy = getHealthyWsProviderEntries();
  if (healthy.length === 0) return null;

  healthy.sort((a, b) => {
    if (Number(b.connected) !== Number(a.connected)) {
      return Number(b.connected) - Number(a.connected);
    }
    if (a.failures !== b.failures) return a.failures - b.failures;
    return a.lastUsedAt - b.lastUsedAt;
  });

  const entry = healthy[wsProviderPointer % healthy.length];
  wsProviderPointer = (wsProviderPointer + 1) % Number.MAX_SAFE_INTEGER;
  entry.lastUsedAt = Date.now();

  return entry;
}

function markHttpProviderSuccess(entry) {
  entry.failures = 0;
  entry.cooldownUntil = 0;
  entry.lastError = '';
  entry.successCount += 1;
  entry.lastSuccessAt = Date.now();
}

function markHttpProviderFailure(entry, error) {
  entry.failures += 1;
  entry.lastError = buildErrorMessage(error) || 'Unknown RPC error';

  if (isOutOfCreditsError(error)) {
    entry.cooldownUntil = Date.now() + getOutOfCreditsCooldownMs();
    return;
  }

  if (isRateLimitError(error)) {
    entry.cooldownUntil = Date.now() + getRateLimitCooldownMs(entry.failures);
    return;
  }

  entry.cooldownUntil = Date.now() + getTransientCooldownMs(entry.failures);
}

function markWsProviderSuccess(entry) {
  entry.failures = 0;
  entry.cooldownUntil = 0;
  entry.lastError = '';
  entry.successCount += 1;
  entry.connected = true;
  entry.lastConnectedAt = Date.now();
  entry.reconnectAttempt = 0;
}

function markWsProviderFailure(entry, error) {
  entry.failures += 1;
  entry.connected = false;
  entry.lastError = buildErrorMessage(error) || 'Unknown WebSocket error';

  if (isOutOfCreditsError(error)) {
    entry.cooldownUntil = Date.now() + getOutOfCreditsCooldownMs();
    return;
  }

  if (isRateLimitError(error)) {
    entry.cooldownUntil = Date.now() + getRateLimitCooldownMs(entry.failures);
    return;
  }

  entry.cooldownUntil = Date.now() + getTransientCooldownMs(entry.failures);
}

async function acquireRpcSlot() {
  if (activeRpcCalls < getHttpMaxConcurrency()) {
    activeRpcCalls += 1;
    return;
  }

  await new Promise((resolve) => {
    waitQueue.push(resolve);
  });

  activeRpcCalls += 1;
}

function releaseRpcSlot() {
  activeRpcCalls = Math.max(0, activeRpcCalls - 1);

  const next = waitQueue.shift();
  if (next) next();
}

function clearWsReconnectTimer(entry) {
  if (entry?.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

// function getWsUnderlyingSocket(provider) {
//   return provider?._websocket || provider?.websocket || null;
// }

function getWsUnderlyingSocket(provider) {
  if (!provider) return null;

  try {
    if (provider._websocket) {
      return provider._websocket;
    }
  } catch {
    // ignore
  }

  try {
    return provider.websocket || null;
  } catch (error) {
    const message = String(
      error?.error?.message ||
      error?.message ||
      error?.shortMessage ||
      ''
    ).toLowerCase();

    if (message.includes('websocket closed')) {
      return null;
    }

    logDebug('[WS_SOCKET_ACCESS_FAILED]', message);
    return null;
  }
}

// function cleanupWsProviderListeners(entry) {
//   const existing = wsProviderListeners.get(entry.id);
//   if (!existing || !entry.provider) return;

//   try {
//     if (existing.blockHandler) {
//       entry.provider.off('block', existing.blockHandler);
//     }
//   } catch {
//     // ignore
//   }

//   const socket = getWsUnderlyingSocket(entry.provider);
//   if (socket) {
//     try {
//       if (existing.openHandler) {
//         socket.removeEventListener?.('open', existing.openHandler);
//         socket.off?.('open', existing.openHandler);
//       }
//       if (existing.closeHandler) {
//         socket.removeEventListener?.('close', existing.closeHandler);
//         socket.off?.('close', existing.closeHandler);
//       }
//       if (existing.errorHandler) {
//         socket.removeEventListener?.('error', existing.errorHandler);
//         socket.off?.('error', existing.errorHandler);
//       }
//     } catch {
//       // ignore
//     }
//   }

//   wsProviderListeners.delete(entry.id);
// }


function cleanupWsProviderListeners(entry) {
  const existing = wsProviderListeners.get(entry.id);
  if (!existing || !entry.provider) return;

  try {
    if (existing.blockHandler) {
      entry.provider.off('block', existing.blockHandler);
    }
  } catch {
    // ignore
  }

  let socket = null;
  try {
    socket = getWsUnderlyingSocket(entry.provider);
  } catch {
    socket = null;
  }

  if (socket) {
    try {
      if (existing.openHandler) {
        socket.removeEventListener?.('open', existing.openHandler);
        socket.off?.('open', existing.openHandler);
      }
      if (existing.closeHandler) {
        socket.removeEventListener?.('close', existing.closeHandler);
        socket.off?.('close', existing.closeHandler);
      }
      if (existing.errorHandler) {
        socket.removeEventListener?.('error', existing.errorHandler);
        socket.off?.('error', existing.errorHandler);
      }
    } catch {
      // ignore
    }
  }

  wsProviderListeners.delete(entry.id);
}

// async function destroyWsProvider(entry) {
//   clearWsReconnectTimer(entry);
//   cleanupWsProviderListeners(entry);

//   if (!entry.provider) {
//     entry.connected = false;
//     return;
//   }

//   const provider = entry.provider;
//   entry.provider = null;
//   entry.connected = false;

//   try {
//     await provider.destroy?.();
//   } catch {
//     // ignore
//   }

//   const socket = getWsUnderlyingSocket(provider);
//   try {
//     socket?.close?.();
//   } catch {
//     // ignore
//   }
// }

async function destroyWsProvider(entry) {
  clearWsReconnectTimer(entry);

  if (!entry.provider) {
    entry.connected = false;
    cleanupWsProviderListeners(entry);
    return;
  }

  const provider = entry.provider;
  entry.provider = null;
  entry.connected = false;

  try {
    cleanupWsProviderListeners({ ...entry, provider });
  } catch {
    // ignore
  }

  try {
    await provider.destroy?.();
  } catch {
    // ignore
  }

  try {
    const socket = getWsUnderlyingSocket(provider);
    socket?.close?.();
  } catch {
    // ignore
  }
}

function scheduleWsReconnect(entry, reason = null) {
  clearWsReconnectTimer(entry);

  entry.reconnectAttempt += 1;

  const baseDelay = getWsReconnectBaseDelayMs();
  const maxDelay = getWsReconnectMaxDelayMs();
  const delayMs = Math.min(
    baseDelay * Math.pow(2, Math.max(0, entry.reconnectAttempt - 1)),
    maxDelay
  );

  entry.reconnectTimer = setTimeout(async () => {
    entry.reconnectTimer = null;
    try {
      await ensureWsProviderConnected(entry);
    } catch (error) {
      logDebug('[WS_RECONNECT_FAILED]', {
        id: entry.id,
        url: entry.url,
        reason: buildErrorMessage(error),
      });
    }
  }, delayMs);

  logDebug('[WS_RECONNECT_SCHEDULED]', {
    id: entry.id,
    url: entry.url,
    reason: reason ? buildErrorMessage(reason) : '',
    delayMs,
    attempt: entry.reconnectAttempt,
  });
}

function broadcastNewBlock(blockNumber) {
  const numericBlock = Number(blockNumber || 0);
  if (!Number.isFinite(numericBlock) || numericBlock <= 0) return;

  if (numericBlock <= lastBroadcastBlock) return;
  lastBroadcastBlock = numericBlock;

  for (const listener of wsBlockListeners) {
    Promise.resolve()
      .then(() => listener(numericBlock))
      .catch((error) => {
        console.error('[WS_BLOCK_LISTENER_ERROR]', error);
      });
  }
}

async function ensureWsProviderConnected(entry) {
  if (!entry) return null;

  const now = Date.now();
  if (entry.cooldownUntil > now) {
    return null;
  }

  if (entry.provider && entry.connected) {
    return entry.provider;
  }

  await destroyWsProvider(entry);

  const provider = new WebSocketProvider(
    entry.url,
    {
      chainId: env.CHAIN_ID,
      name: `chain-${env.CHAIN_ID}`,
    }
  );

  entry.provider = provider;
  entry.providerInstanceId += 1;
  const instanceId = entry.providerInstanceId;

  const blockHandler = (blockNumber) => {
    if (entry.providerInstanceId !== instanceId) return;
    entry.connected = true;
    entry.lastBlockAt = Date.now();
    entry.lastBlockNumber = Number(blockNumber || 0);
    markWsProviderSuccess(entry);
    broadcastNewBlock(blockNumber);
  };

  const socket = getWsUnderlyingSocket(provider);

  const openHandler = () => {
    if (entry.providerInstanceId !== instanceId) return;
    markWsProviderSuccess(entry);
    logDebug('[WS_OPEN]', { id: entry.id, url: entry.url });
  };

  const closeHandler = async (event) => {
    if (entry.providerInstanceId !== instanceId) return;

    const closeError = new Error(
      `WebSocket closed ${event?.code ?? ''} ${event?.reason ?? ''}`.trim()
    );

    markWsProviderFailure(entry, closeError);
    await destroyWsProvider(entry);
    scheduleWsReconnect(entry, closeError);
  };

  const errorHandler = async (error) => {
    if (entry.providerInstanceId !== instanceId) return;

    markWsProviderFailure(entry, error);
    await destroyWsProvider(entry);
    scheduleWsReconnect(entry, error);
  };

  provider.on('block', blockHandler);

  if (socket) {
    socket.addEventListener?.('open', openHandler);
    socket.addEventListener?.('close', closeHandler);
    socket.addEventListener?.('error', errorHandler);

    socket.on?.('open', openHandler);
    socket.on?.('close', closeHandler);
    socket.on?.('error', errorHandler);
  }

  wsProviderListeners.set(entry.id, {
    blockHandler,
    openHandler,
    closeHandler,
    errorHandler,
  });

  try {
    await provider.getBlockNumber();
    markWsProviderSuccess(entry);
    return provider;
  } catch (error) {
    markWsProviderFailure(entry, error);
    await destroyWsProvider(entry);
    scheduleWsReconnect(entry, error);
    return null;
  }
}

async function ensureAllWsProvidersStarted() {
  initProviders();

  if (wsProviderEntries.length === 0) {
    return [];
  }

  const providers = await Promise.all(
    wsProviderEntries.map((entry) => ensureWsProviderConnected(entry))
  );

  return providers.filter(Boolean);
}

function startFallbackBlockPoller() {
  if (fallbackBlockPoller) return;

  fallbackBlockPoller = setInterval(async () => {
    if (wsBlockListeners.size === 0) return;

    const hasConnectedWs = wsProviderEntries.some((entry) => entry.connected);
    if (hasConnectedWs) return;

    try {
      const latestBlock = await safeRpcCall((provider) => provider.getBlockNumber(), 1, 500);
      broadcastNewBlock(latestBlock);
    } catch (error) {
      logDebug('[FALLBACK_BLOCK_POLL_FAILED]', buildErrorMessage(error));
    }
  }, getFallbackPollIntervalMs());
}

function ensureWsBlockSubscriptionStarted() {
  if (wsBlockSubscriptionStarted) return;

  wsBlockSubscriptionStarted = true;
  initProviders();

  if (wsProviderEntries.length > 0) {
    ensureAllWsProvidersStarted().catch((error) => {
      console.error('[WS_BOOTSTRAP_FAILED]', error);
    });
  }

  startFallbackBlockPoller();
}

export function onNewBlock(listener) {
  if (typeof listener !== 'function') {
    throw new Error('onNewBlock listener must be a function');
  }

  wsBlockListeners.add(listener);
  ensureWsBlockSubscriptionStarted();

  return () => {
    wsBlockListeners.delete(listener);
  };
}

export function getProvider() {
  return pickNextHttpProviderEntry().provider;
}

export function getWsProvider() {
  initProviders();

  const entry = pickNextWsProviderEntry();
  return entry?.provider || null;
}

export async function ensureRealtimeProviders() {
  ensureWsBlockSubscriptionStarted();
  return ensureAllWsProvidersStarted();
}

export function getProviderHealthSnapshot() {
  initProviders();

  return {
    http: httpProviderEntries.map((entry) => ({
      id: entry.id,
      type: 'http',
      url: entry.url,
      failures: entry.failures,
      successCount: entry.successCount,
      cooldownUntil: entry.cooldownUntil,
      coolingDown: entry.cooldownUntil > Date.now(),
      lastError: entry.lastError,
      lastSuccessAt: entry.lastSuccessAt,
      lastUsedAt: entry.lastUsedAt,
    })),
    ws: wsProviderEntries.map((entry) => ({
      id: entry.id,
      type: 'ws',
      url: entry.url,
      failures: entry.failures,
      successCount: entry.successCount,
      cooldownUntil: entry.cooldownUntil,
      coolingDown: entry.cooldownUntil > Date.now(),
      connected: entry.connected,
      reconnectAttempt: entry.reconnectAttempt,
      lastError: entry.lastError,
      lastConnectedAt: entry.lastConnectedAt,
      lastBlockAt: entry.lastBlockAt,
      lastBlockNumber: entry.lastBlockNumber,
      lastUsedAt: entry.lastUsedAt,
    })),
    activeRpcCalls,
    queuedRpcCalls: waitQueue.length,
  };
}

export async function safeRpcCall(
  fn,
  retries = getHttpRetryAttempts(),
  baseDelayMs = getHttpRetryBaseDelayMs()
) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    await acquireRpcSlot();

    const entry = pickNextHttpProviderEntry();
    let releasedEarly = false;

    try {
      const result = await fn(entry.provider, entry);
      markHttpProviderSuccess(entry);
      return result;
    } catch (error) {
      lastError = error;

      if (!isTransientRpcError(error)) {
        throw error;
      }

      markHttpProviderFailure(entry, error);

      if (attempt >= retries) {
        break;
      }

      const waitMs = isOutOfCreditsError(error)
        ? getOutOfCreditsCooldownMs()
        : isRateLimitError(error)
          ? Math.min(baseDelayMs * Math.pow(2, attempt), getRateLimitCooldownMs(entry.failures))
          : Math.min(baseDelayMs * Math.pow(2, attempt), getTransientCooldownMs(entry.failures));

      if (isDebugLoggingEnabled()) {
        console.warn(
          `[RPC] ${entry.id} retry ${attempt + 1}/${retries} after ${waitMs}ms`,
          buildErrorMessage(error)
        );
      }

      releaseRpcSlot();
      releasedEarly = true;

      await sleep(waitMs);
      attempt += 1;
      continue;
    } finally {
      if (!releasedEarly && activeRpcCalls > 0) {
        releaseRpcSlot();
      }
    }
  }

  throw lastError || new Error('All RPC providers failed');
}

export async function connectBlockchain() {
  initProviders();

  const network = await safeRpcCall((provider) => provider.getNetwork());
  const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

  ensureWsBlockSubscriptionStarted();

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
    providers: getProviderHealthSnapshot(),
  };
}





//==============
// THIRD VERSION
//=====================
// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerEntries = [];
// let providerPointer = 0;

// let activeRpcCalls = 0;
// const waitQueue = [];

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function buildErrorMessage(error) {
//   return (
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '')
//   ).trim();
// }

// function isRateLimitError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
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
//     lower.includes('quota exceeded')
//   );
// }

// function isTransientRpcError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     isRateLimitError(error) ||
//     isOutOfCreditsError(error) ||
//     lower.includes('timeout') ||
//     lower.includes('socket hang up') ||
//     lower.includes('network error') ||
//     lower.includes('failed to detect network') ||
//     lower.includes('missing response') ||
//     lower.includes('bad gateway') ||
//     lower.includes('gateway timeout') ||
//     lower.includes('server error')
//   );
// }

// function initProviders() {
//   if (providerEntries.length > 0) return providerEntries;

//   providerEntries = env.RPC_URLS.map((url, index) => ({
//     id: `rpc-${index + 1}`,
//     url,
//     provider: new JsonRpcProvider(
//       url,
//       {
//         chainId: env.CHAIN_ID,
//         name: `chain-${env.CHAIN_ID}`,
//       },
//       {
//         staticNetwork: true,
//       }
//     ),
//     failures: 0,
//     cooldownUntil: 0,
//     lastError: '',
//     successCount: 0,
//   }));

//   return providerEntries;
// }

// function getHealthyProviderEntries() {
//   initProviders();
//   const now = Date.now();

//   const healthy = providerEntries.filter(
//     (entry) => entry.cooldownUntil <= now
//   );

//   return healthy.length > 0 ? healthy : providerEntries;
// }

// function pickNextProviderEntry() {
//   const healthy = getHealthyProviderEntries();

//   // round robin but prefer less failed providers
//   healthy.sort((a, b) => a.failures - b.failures);

//   const entry = healthy[providerPointer % healthy.length];
//   providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;

//   return entry;
// }

// function markProviderSuccess(entry) {
//   entry.failures = 0;
//   entry.cooldownUntil = 0;
//   entry.lastError = '';
//   entry.successCount += 1;
// }

// function markProviderFailure(entry, error) {
//   entry.failures += 1;
//   entry.lastError =
//     error?.shortMessage ||
//     error?.message ||
//     error?.info?.responseStatus ||
//     'Unknown RPC error';

//   if (isOutOfCreditsError(error)) {
//     entry.cooldownUntil = Date.now() + env.RPC_OUT_OF_CREDITS_COOLDOWN_MS;
//     return;
//   }

//   const cooldownMs = Math.min(2000 * entry.failures, 15000);
//   entry.cooldownUntil = Date.now() + cooldownMs;
// }

// async function acquireRpcSlot() {
//   if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
//     activeRpcCalls += 1;
//     return;
//   }

//   await new Promise((resolve) => {
//     waitQueue.push(resolve);
//   });

//   activeRpcCalls += 1;
// }

// function releaseRpcSlot() {
//   activeRpcCalls = Math.max(0, activeRpcCalls - 1);
//   const next = waitQueue.shift();
//   if (next) next();
// }

// export function getProvider() {
//   return pickNextProviderEntry().provider;
// }

// export function getProviderHealthSnapshot() {
//   initProviders();

//   return providerEntries.map((entry) => ({
//     id: entry.id,
//     url: entry.url,
//     failures: entry.failures,
//     successCount: entry.successCount,
//     cooldownUntil: entry.cooldownUntil,
//     coolingDown: entry.cooldownUntil > Date.now(),
//     lastError: entry.lastError,
//   }));
// }

// export async function safeRpcCall(
//   fn,
//   retries = env.RPC_RETRY_ATTEMPTS,
//   baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
// ) {
//   let attempt = 0;
//   let lastError = null;

//   while (attempt <= retries) {
//     await acquireRpcSlot();

//     const entry = pickNextProviderEntry();
//     let releasedEarly = false;

//     try {
//       const result = await fn(entry.provider, entry);
//       markProviderSuccess(entry);
//       return result;
//     } catch (err) {
//       lastError = err;

//       if (!isTransientRpcError(err)) {
//         throw err;
//       }

//       markProviderFailure(entry, err);

//       if (attempt >= retries) {
//         break;
//       }

//       const waitMs = isOutOfCreditsError(err)
//         ? env.RPC_OUT_OF_CREDITS_COOLDOWN_MS
//         : Math.min(baseDelayMs * Math.pow(2, attempt), 10000);

//       if (env.LOG_LEVEL === 'debug') {
//         console.warn(
//           `[RPC] ${entry.id} retry ${attempt + 1}/${retries} after ${waitMs}ms`,
//           buildErrorMessage(err)
//         );
//       }

//       releaseRpcSlot();
//       releasedEarly = true;

//       await sleep(waitMs);
//       attempt += 1;
//       continue;
//     } finally {
//       if (!releasedEarly && activeRpcCalls > 0) {
//         releaseRpcSlot();
//       }
//     }
//   }

//   throw lastError || new Error('All RPC providers failed');
// }

// export async function connectBlockchain() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const blockNumber = await safeRpcCall((provider) =>
//     provider.getBlockNumber()
//   );

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//     providers: getProviderHealthSnapshot(),
//   };
// }












//======================
//  SECOND VERSION
//=====================
// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerEntries = [];
// let providerPointer = 0;

// let activeRpcCalls = 0;
// const waitQueue = [];

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function buildErrorMessage(error) {
//   return (
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '')
//   ).trim();
// }

// function isRateLimitError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
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
//     lower.includes('quota exceeded')
//   );
// }

// function isTransientRpcError(error) {
//   const lower = buildErrorMessage(error).toLowerCase();

//   return (
//     isRateLimitError(error) ||
//     isOutOfCreditsError(error) ||
//     lower.includes('timeout') ||
//     lower.includes('socket hang up') ||
//     lower.includes('network error') ||
//     lower.includes('failed to detect network') ||
//     lower.includes('missing response') ||
//     lower.includes('bad gateway') ||
//     lower.includes('gateway timeout') ||
//     lower.includes('server error')
//   );
// }

// function initProviders() {
//   if (providerEntries.length > 0) return providerEntries;

//   providerEntries = env.RPC_URLS.map((url, index) => ({
//     id: `rpc-${index + 1}`,
//     url,
//     provider: new JsonRpcProvider(
//       url,
//       {
//         chainId: env.CHAIN_ID,
//         name: `chain-${env.CHAIN_ID}`,
//       },
//       {
//         staticNetwork: true,
//       }
//     ),
//     failures: 0,
//     cooldownUntil: 0,
//     lastError: '',
//   }));

//   return providerEntries;
// }

// function getHealthyProviderEntries() {
//   initProviders();
//   const now = Date.now();
//   const healthy = providerEntries.filter((entry) => entry.cooldownUntil <= now);
//   return healthy.length > 0 ? healthy : providerEntries;
// }

// function pickNextProviderEntry() {
//   const healthy = getHealthyProviderEntries();
//   const entry = healthy[providerPointer % healthy.length];
//   providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;
//   return entry;
// }

// function markProviderSuccess(entry) {
//   entry.failures = 0;
//   entry.cooldownUntil = 0;
//   entry.lastError = '';
// }

// function markProviderFailure(entry, error) {
//   entry.failures += 1;
//   entry.lastError =
//     error?.shortMessage ||
//     error?.message ||
//     error?.info?.responseStatus ||
//     'Unknown RPC error';

//   if (isOutOfCreditsError(error)) {
//     entry.cooldownUntil = Date.now() + env.RPC_OUT_OF_CREDITS_COOLDOWN_MS;
//     return;
//   }

//   const cooldownMs = Math.min(2000 * entry.failures, 15000);
//   entry.cooldownUntil = Date.now() + cooldownMs;
// }

// async function acquireRpcSlot() {
//   if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
//     activeRpcCalls += 1;
//     return;
//   }

//   await new Promise((resolve) => {
//     waitQueue.push(resolve);
//   });

//   activeRpcCalls += 1;
// }

// function releaseRpcSlot() {
//   activeRpcCalls = Math.max(0, activeRpcCalls - 1);
//   const next = waitQueue.shift();
//   if (next) next();
// }

// export function getProvider() {
//   return pickNextProviderEntry().provider;
// }

// export function getProviderHealthSnapshot() {
//   initProviders();

//   return providerEntries.map((entry) => ({
//     id: entry.id,
//     url: entry.url,
//     failures: entry.failures,
//     cooldownUntil: entry.cooldownUntil,
//     coolingDown: entry.cooldownUntil > Date.now(),
//     lastError: entry.lastError,
//   }));
// }

// export async function safeRpcCall(
//   fn,
//   retries = env.RPC_RETRY_ATTEMPTS,
//   baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
// ) {
//   let attempt = 0;
//   let lastError = null;

//   while (attempt <= retries) {
//     await acquireRpcSlot();

//     const entry = pickNextProviderEntry();
//     let releasedEarly = false;

//     try {
//       const result = await fn(entry.provider, entry);
//       markProviderSuccess(entry);
//       return result;
//     } catch (err) {
//       lastError = err;

//       if (!isTransientRpcError(err)) {
//         throw err;
//       }

//       markProviderFailure(entry, err);

//       if (attempt >= retries) {
//         break;
//       }

//       const waitMs = isOutOfCreditsError(err)
//         ? env.RPC_OUT_OF_CREDITS_COOLDOWN_MS
//         : Math.min(baseDelayMs * Math.pow(2, attempt), 10000);

//       if (isOutOfCreditsError(err)) {
//         console.warn(
//           `[RPC] ${entry.id} exhausted or out of credits; cooling down for ${waitMs}ms`
//         );
//       } else {
//         console.warn(
//           `[RPC] ${entry.id} transient failure detected; retrying in ${waitMs}ms`
//         );
//       }

//       releaseRpcSlot();
//       releasedEarly = true;

//       await sleep(waitMs);
//       attempt += 1;
//       continue;
//     } finally {
//       if (!releasedEarly && activeRpcCalls > 0) {
//         releaseRpcSlot();
//       }
//     }
//   }

//   throw lastError || new Error('All RPC providers failed');
// }

// export async function connectBlockchain() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//     providers: getProviderHealthSnapshot(),
//   };
// }










//========================================
// FIRST VERSION
//========================================
// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerEntries = [];
// let providerPointer = 0;

// let activeRpcCalls = 0;
// const waitQueue = [];

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// function isRateLimitError(error) {
//   const msg =
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '');

//   const lower = msg.toLowerCase();

//   return (
//     lower.includes('429') ||
//     lower.includes('1015') ||
//     lower.includes('rate limit') ||
//     lower.includes('too many requests') ||
//     lower.includes('throughput') ||
//     lower.includes('compute units per second') ||
//     lower.includes('exceeded maximum retry limit')
//   );
// }

// function isTransientRpcError(error) {
//   const msg =
//     String(error?.message || '') +
//     ' ' +
//     String(error?.shortMessage || '') +
//     ' ' +
//     String(error?.info?.responseStatus || '') +
//     ' ' +
//     String(error?.info?.responseBody || '');

//   const lower = msg.toLowerCase();

//   return (
//     isRateLimitError(error) ||
//     lower.includes('timeout') ||
//     lower.includes('socket hang up') ||
//     lower.includes('network error') ||
//     lower.includes('failed to detect network') ||
//     lower.includes('missing response') ||
//     lower.includes('bad gateway') ||
//     lower.includes('gateway timeout') ||
//     lower.includes('server error')
//   );
// }

// function initProviders() {
//   if (providerEntries.length > 0) return providerEntries;

//   providerEntries = env.RPC_URLS.map((url, index) => ({
//     id: `rpc-${index + 1}`,
//     url,
//     provider: new JsonRpcProvider(
//       url,
//       {
//         chainId: env.CHAIN_ID,
//         name: `chain-${env.CHAIN_ID}`,
//       },
//       {
//         staticNetwork: true,
//       }
//     ),
//     failures: 0,
//     cooldownUntil: 0,
//     lastError: '',
//   }));

//   return providerEntries;
// }

// function getHealthyProviderEntries() {
//   initProviders();
//   const now = Date.now();
//   const healthy = providerEntries.filter((entry) => entry.cooldownUntil <= now);
//   return healthy.length > 0 ? healthy : providerEntries;
// }

// function pickNextProviderEntry() {
//   const healthy = getHealthyProviderEntries();
//   const entry = healthy[providerPointer % healthy.length];
//   providerPointer = (providerPointer + 1) % Number.MAX_SAFE_INTEGER;
//   return entry;
// }

// function markProviderSuccess(entry) {
//   entry.failures = 0;
//   entry.cooldownUntil = 0;
//   entry.lastError = '';
// }

// function markProviderFailure(entry, error) {
//   entry.failures += 1;
//   entry.lastError =
//     error?.shortMessage ||
//     error?.message ||
//     error?.info?.responseStatus ||
//     'Unknown RPC error';

//   const cooldownMs = Math.min(2000 * entry.failures, 15000);
//   entry.cooldownUntil = Date.now() + cooldownMs;
// }

// async function acquireRpcSlot() {
//   if (activeRpcCalls < env.RPC_MAX_CONCURRENCY) {
//     activeRpcCalls += 1;
//     return;
//   }

//   await new Promise((resolve) => {
//     waitQueue.push(resolve);
//   });

//   activeRpcCalls += 1;
// }

// function releaseRpcSlot() {
//   activeRpcCalls = Math.max(0, activeRpcCalls - 1);
//   const next = waitQueue.shift();
//   if (next) next();
// }

// export function getProvider() {
//   return pickNextProviderEntry().provider;
// }

// export function getProviderHealthSnapshot() {
//   initProviders();

//   return providerEntries.map((entry) => ({
//     id: entry.id,
//     url: entry.url,
//     failures: entry.failures,
//     cooldownUntil: entry.cooldownUntil,
//     coolingDown: entry.cooldownUntil > Date.now(),
//     lastError: entry.lastError,
//   }));
// }

// export async function safeRpcCall(
//   fn,
//   retries = env.RPC_RETRY_ATTEMPTS,
//   baseDelayMs = env.RPC_RETRY_BASE_DELAY_MS
// ) {
//   let attempt = 0;
//   let lastError = null;

//   while (attempt <= retries) {
//     await acquireRpcSlot();

//     const entry = pickNextProviderEntry();

//     try {
//       const result = await fn(entry.provider, entry);
//       markProviderSuccess(entry);
//       return result;
//     } catch (err) {
//       lastError = err;

//       if (!isTransientRpcError(err)) {
//         throw err;
//       }

//       markProviderFailure(entry, err);

//       if (attempt >= retries) {
//         break;
//       }

//       const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt), 10000);
//       console.warn(
//         `[RPC] ${entry.id} transient failure detected; retrying in ${waitMs}ms`
//       );

//       releaseRpcSlot();
//       await sleep(waitMs);
//       attempt += 1;
//       continue;
//     } finally {
//       if (activeRpcCalls > 0) {
//         releaseRpcSlot();
//       }
//     }
//   }

//   throw lastError || new Error('All RPC providers failed');
// }

// export async function connectBlockchain() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   const blockNumber = await safeRpcCall((provider) => provider.getBlockNumber());

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//     providers: getProviderHealthSnapshot(),
//   };
// }
