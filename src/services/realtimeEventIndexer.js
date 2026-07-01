import { Contract, WebSocketProvider } from 'ethers';
import env from '../config/env.js';
import { safeRpcCall } from '../blockchain/provider.js';
import { getContracts } from '../blockchain/contracts.js';

import {
  getBlockCached,
  saveReceiptLog,
  saveRegistrationLog,
  saveOrbitLog,
  saveTokenLog,
  saveEscrowLog,
  saveActivationSummaryLog,
  saveFinancialEventLog,
} from './indexerService.js';

let realtimeStarted = false;
let activeListeners = [];
let currentWsProvider = null;
let currentSocket = null;
let currentSocketHandlers = null;
let reconnectTimer = null;
let reconnecting = false;
let stopping = false;
let currentWsIndex = 0;
let activeEventSaves = 0;
const eventQueue = [];

const REALTIME_QUEUE_CONCURRENCY = Math.max(
  1,
  Math.min(Number(env.REALTIME_EVENT_QUEUE_CONCURRENCY) || 4, 25)
);
const REALTIME_QUEUE_MAX = Math.max(
  REALTIME_QUEUE_CONCURRENCY,
  Number(env.REALTIME_EVENT_QUEUE_MAX) || 1000
);
const REALTIME_SUBSCRIPTION_DELAY_MS = Math.max(
  0,
  Number(env.REALTIME_SUBSCRIPTION_DELAY_MS) || 150
);

const realtimeHealth = {
  running: false,
  connected: false,
  currentWsUrl: '',
  currentWsIndex: -1,
  reconnectAttempt: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastEventAt: null,
  lastSavedAt: null,
  lastError: '',
  listenersAttached: 0,
  queueDepth: 0,
  activeSaves: 0,
};



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


async function getChainId() {
  const network = await safeRpcCall((provider) => provider.getNetwork());
  return Number(network.chainId);
}

function normalizeLog(eventPayload) {
  const log = eventPayload?.log || eventPayload;

  return {
    ...log,
    index: Number(log?.index ?? log?.logIndex ?? -1),
    logIndex: Number(log?.index ?? log?.logIndex ?? -1),
  };
}

function getOrbitType(label) {
  if (label === 'p4Orbit') return 'P4';
  if (label === 'p12Orbit') return 'P12';
  if (label === 'p39Orbit') return 'P39';
  return null;
}

function getWsUrls() {
  if (Array.isArray(env.WS_RPC_URLS)) {
    return env.WS_RPC_URLS.map((url) => String(url).trim()).filter(Boolean);
  }

  return String(env.WS_RPC_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function getReconnectBaseDelayMs() {
  return Math.max(250, Number(env.WS_RECONNECT_BASE_DELAY_MS) || 2000);
}

function getReconnectMaxDelayMs() {
  return Math.max(
    getReconnectBaseDelayMs(),
    Number(env.WS_RECONNECT_MAX_DELAY_MS) || 30000
  );
}

function getSocket(provider) {
  if (!provider) return null;

  try {
    return provider.websocket || provider._websocket || null;
  } catch {
    return null;
  }
}

function updateQueueHealth() {
  realtimeHealth.queueDepth = eventQueue.length;
  realtimeHealth.activeSaves = activeEventSaves;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWsContract(httpContract, wsProvider) {
  if (!httpContract || !wsProvider) return null;
  return new Contract(httpContract.target, httpContract.interface, wsProvider);
}

function buildListenerSpecs() {
  return [
    ['registration', 'Registered'],
    ['registration', 'LevelActivated'],
    ['levelManager', 'FounderRepActivated'],
    ['levelManager', 'DetailedPayoutReceiptRecorded'],
    ['levelManager', 'ActivationFinancialSummaryRecorded'],
    ['levelManager', 'PayoutNotDelivered'],
    ['levelManager', 'RecycleCompletedDetailed'],
    ['levelManager', 'AutoUpgradeCompleted'],
    ['levelManager', 'FounderDistributionDetailed'],
    ['levelManager', 'SystemChargeDistributedDetailed'],
    ['autoUpgradeEscrow', 'EscrowLocked'],
    ['autoUpgradeEscrow', 'EscrowUsedForUpgrade'],
    ['autoUpgradeEscrow', 'EscrowReleasedToUser'],
    ['p4Orbit', 'PositionFilled'],
    ['p4Orbit', 'OrbitReset'],
    ['p4Orbit', 'LinePaymentTracked'],
    ['p4Orbit', 'PaymentRuleApplied'],
    ['p4Orbit', 'SpilloverPaid'],
    ['p4Orbit', 'EscrowUpdated'],
    ['p4Orbit', 'AutoUpgradeTriggered'],
    ['p4Orbit', 'PositionActivationLinked'],
    ['p4Orbit', 'OrbitDependencyUpdated'],
    ['p12Orbit', 'PositionFilled'],
    ['p12Orbit', 'OrbitReset'],
    ['p12Orbit', 'LinePaymentTracked'],
    ['p12Orbit', 'PaymentRuleApplied'],
    ['p12Orbit', 'SpilloverPaid'],
    ['p12Orbit', 'EscrowUpdated'],
    ['p12Orbit', 'AutoUpgradeTriggered'],
    ['p12Orbit', 'PositionActivationLinked'],
    ['p12Orbit', 'OrbitDependencyUpdated'],
    ['p39Orbit', 'PositionFilled'],
    ['p39Orbit', 'OrbitReset'],
    ['p39Orbit', 'LinePaymentTracked'],
    ['p39Orbit', 'PaymentRuleApplied'],
    ['p39Orbit', 'SpilloverPaid'],
    ['p39Orbit', 'EscrowUpdated'],
    ['p39Orbit', 'AutoUpgradeTriggered'],
    ['p39Orbit', 'PositionActivationLinked'],
    ['p39Orbit', 'OrbitDependencyUpdated'],
    ['fgtToken', 'UtilityMinted'],
    ['fgtToken', 'UtilityBurned'],
    ['fgtToken', 'UtilityLocked'],
    ['fgtrToken', 'UtilityMinted'],
    ['fgtrToken', 'UtilityBurned'],
    ['fgtrToken', 'UtilityLocked'],
    ['freedomTokenController', 'TokenRewardEligibility'],
  ];
}

async function attachListener(contract, eventName, label) {
  if (!contract) return;

  const handler = (...args) => {
    const eventPayload = args[args.length - 1];
    const log = normalizeLog(eventPayload);

    realtimeHealth.lastEventAt = new Date();

    if (eventQueue.length >= REALTIME_QUEUE_MAX) {
      const message = '[REALTIME_EVENT_QUEUE_FULL]';
      realtimeHealth.lastError = message;
      console.error(message, {
        label,
        eventName,
        txHash: log?.transactionHash || '',
        logIndex: Number(log?.index ?? -1),
        queueDepth: eventQueue.length,
      });
      return;
    }

    eventQueue.push({ contract, eventName, label, log });
    updateQueueHealth();
    drainEventQueue();
  };

  await contract.on(eventName, handler);

  activeListeners.push({
    contract,
    eventName,
    handler,
    label,
  });
}

async function processRealtimeEvent({ contract, eventName, label, log }) {
  try {
    const chainId = await getChainId();
    const block = await getBlockCached(log.blockNumber);

    if (!block) {
      throw new Error(`[REALTIME_MISSING_BLOCK] ${eventName} ${log.transactionHash}:${log.index}`);
    }

    const parsed = contract.interface.parseLog(log);

    if (!parsed) {
      return;
    }

    if (
      label === 'registration' &&
      ['Registered', 'LevelActivated'].includes(parsed.name)
    ) {
      await saveRegistrationLog(chainId, contract.target, log, parsed, block);
    }

    if (label === 'levelManager') {
      if (parsed.name === 'FounderRepActivated') {
        await saveRegistrationLog(chainId, contract.target, log, parsed, block);
      }

      if (parsed.name === 'DetailedPayoutReceiptRecorded') {
        await saveReceiptLog(chainId, log, parsed, block);
      }

      if (parsed.name === 'ActivationFinancialSummaryRecorded') {
        await saveActivationSummaryLog(chainId, log, parsed, block);
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
        await saveFinancialEventLog(chainId, contract.target, log, parsed, block);
      }
    }

    if (
      label === 'freedomTokenController' &&
      parsed.name === 'TokenRewardEligibility'
    ) {
      await saveFinancialEventLog(chainId, contract.target, log, parsed, block);
    }

    if (
      label === 'autoUpgradeEscrow' &&
      ['EscrowLocked', 'EscrowUsedForUpgrade', 'EscrowReleasedToUser'].includes(parsed.name)
    ) {
      await saveEscrowLog(chainId, contract.target, log, parsed, block);
    }

    if (label === 'fgtToken' || label === 'fgtrToken') {
      if (['UtilityMinted', 'UtilityBurned', 'UtilityLocked'].includes(parsed.name)) {
        const symbol = label === 'fgtToken' ? 'FGT' : 'FGTr';
        await saveTokenLog(chainId, symbol, log, parsed, block);
      }
    }

    const orbitType = getOrbitType(label);

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
      await saveOrbitLog(chainId, orbitType, contract.target, log, parsed, block);
    }

    console.log('[REALTIME_EVENT_SAVED]', {
      label,
      eventName: parsed.name,
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
    });
    realtimeHealth.lastSavedAt = new Date();
    realtimeHealth.lastError = '';
  } catch (error) {
    realtimeHealth.lastError = buildErrorMessage(error);
    console.error('[REALTIME_EVENT_SAVE_FAILED]', {
      label,
      eventName,
      txHash: log?.transactionHash || '',
      logIndex: Number(log?.index ?? -1),
      message: buildErrorMessage(error),
    });
  }
}

function drainEventQueue() {
  updateQueueHealth();

  while (activeEventSaves < REALTIME_QUEUE_CONCURRENCY && eventQueue.length > 0) {
    const item = eventQueue.shift();
    activeEventSaves += 1;
    updateQueueHealth();

    Promise.resolve()
      .then(() => processRealtimeEvent(item))
      .finally(() => {
        activeEventSaves = Math.max(0, activeEventSaves - 1);
        updateQueueHealth();
        drainEventQueue();
      });
  }
}

function detachActiveListeners() {
  for (const item of activeListeners) {
    try {
      item.contract.off(item.eventName, item.handler);
    } catch (error) {
      console.error('[REALTIME_LISTENER_DETACH_FAILED]', {
        label: item.label,
        eventName: item.eventName,
        message: buildErrorMessage(error),
      });
    }
  }

  activeListeners = [];
  realtimeHealth.listenersAttached = 0;
}

function detachSocketHandlers() {
  if (!currentSocket || !currentSocketHandlers) return;

  const { openHandler, closeHandler, errorHandler } = currentSocketHandlers;

  try {
    if (typeof currentSocket.removeEventListener === 'function') {
      currentSocket.removeEventListener('open', openHandler);
      currentSocket.removeEventListener('close', closeHandler);
      currentSocket.removeEventListener('error', errorHandler);
    } else if (typeof currentSocket.off === 'function') {
      currentSocket.off('open', openHandler);
      currentSocket.off('close', closeHandler);
      currentSocket.off('error', errorHandler);
    }
  } catch {
    // ignore detach errors on dead sockets
  }

  currentSocket = null;
  currentSocketHandlers = null;
}

async function cleanupRealtimeProvider() {
  detachActiveListeners();
  detachSocketHandlers();

  const provider = currentWsProvider;
  currentWsProvider = null;

  if (!provider) return;

  try {
    await provider.destroy?.();
  } catch (error) {
    console.error('[REALTIME_PROVIDER_DESTROY_FAILED]', {
      message: buildErrorMessage(error),
    });
  }
}

function scheduleReconnect(reason = null) {
  if (stopping || !realtimeStarted || reconnectTimer) return;

  reconnecting = true;
  realtimeHealth.connected = false;
  realtimeHealth.lastDisconnectedAt = new Date();
  realtimeHealth.lastError = reason ? buildErrorMessage(reason) : realtimeHealth.lastError;
  realtimeHealth.reconnectAttempt += 1;

  const wsUrls = getWsUrls();
  if (wsUrls.length === 0) {
    realtimeHealth.lastError = 'WS_RPC_URLS is not configured';
    return;
  }

  const delayMs = Math.min(
    getReconnectBaseDelayMs() * Math.pow(2, Math.max(0, realtimeHealth.reconnectAttempt - 1)),
    getReconnectMaxDelayMs()
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    currentWsIndex = (currentWsIndex + 1) % wsUrls.length;

    try {
      await connectRealtimeProvider();
    } catch (error) {
      console.error('[REALTIME_EVENT_RECONNECT_FAILED]', {
        message: buildErrorMessage(error),
      });
      await cleanupRealtimeProvider();
      scheduleReconnect(error);
    }
  }, delayMs);

  console.warn('[REALTIME_EVENT_RECONNECT_SCHEDULED]', {
    delayMs,
    reconnectAttempt: realtimeHealth.reconnectAttempt,
    nextWsIndex: (currentWsIndex + 1) % wsUrls.length,
    reason: reason ? buildErrorMessage(reason) : '',
  });
}

function attachSocketHandlers(provider) {
  const socket = getSocket(provider);
  currentSocket = socket;

  if (!socket) return;

  const openHandler = () => {
    realtimeHealth.connected = true;
    realtimeHealth.lastConnectedAt = new Date();
    realtimeHealth.lastError = '';
    realtimeHealth.reconnectAttempt = 0;
    console.log('[REALTIME_EVENT_WS_OPEN]', {
      url: realtimeHealth.currentWsUrl,
      index: realtimeHealth.currentWsIndex,
    });
  };

  const closeHandler = (event) => {
    const error = new Error(
      `WebSocket closed ${event?.code ?? ''} ${event?.reason ?? ''}`.trim()
    );
    console.error('[REALTIME_EVENT_WS_CLOSED]', {
      code: event?.code,
      reason: event?.reason,
      url: realtimeHealth.currentWsUrl,
    });
    cleanupRealtimeProvider()
      .then(() => scheduleReconnect(error))
      .catch((cleanupError) => scheduleReconnect(cleanupError));
  };

  const errorHandler = (error) => {
    console.error('[REALTIME_EVENT_WS_ERROR]', {
      message: buildErrorMessage(error),
      url: realtimeHealth.currentWsUrl,
    });
    cleanupRealtimeProvider()
      .then(() => scheduleReconnect(error))
      .catch((cleanupError) => scheduleReconnect(cleanupError));
  };

  currentSocketHandlers = {
    openHandler,
    closeHandler,
    errorHandler,
  };

  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener('open', openHandler);
    socket.addEventListener('close', closeHandler);
    socket.addEventListener('error', errorHandler);
  } else if (typeof socket.on === 'function') {
    socket.on('open', openHandler);
    socket.on('close', closeHandler);
    socket.on('error', errorHandler);
  }
}

async function connectRealtimeProvider() {
  const wsUrls = getWsUrls();

  if (wsUrls.length === 0) {
    throw new Error('WS_RPC_URLS is not configured');
  }

  await cleanupRealtimeProvider();

  const wsUrl = wsUrls[currentWsIndex % wsUrls.length];
  currentWsProvider = new WebSocketProvider(wsUrl, {
    chainId: Number(env.CHAIN_ID),
    name: `chain-${env.CHAIN_ID}`,
  });

  realtimeHealth.currentWsUrl = wsUrl;
  realtimeHealth.currentWsIndex = currentWsIndex % wsUrls.length;
  realtimeHealth.connected = false;

  attachSocketHandlers(currentWsProvider);

  const contracts = getContracts();
  const wsContracts = {
    registration: buildWsContract(contracts.registration, currentWsProvider),
    levelManager: buildWsContract(contracts.levelManager, currentWsProvider),
    autoUpgradeEscrow: buildWsContract(
      contracts.autoUpgradeEscrow || contracts.escrow,
      currentWsProvider
    ),
    p4Orbit: buildWsContract(contracts.p4Orbit, currentWsProvider),
    p12Orbit: buildWsContract(contracts.p12Orbit, currentWsProvider),
    p39Orbit: buildWsContract(contracts.p39Orbit, currentWsProvider),
    fgtToken: buildWsContract(contracts.fgtToken, currentWsProvider),
    fgtrToken: buildWsContract(contracts.fgtrToken, currentWsProvider),
    freedomTokenController: buildWsContract(contracts.freedomTokenController, currentWsProvider),
  };

  const listenerSpecs = buildListenerSpecs();

  for (let index = 0; index < listenerSpecs.length; index += 1) {
    const [label, eventName] = listenerSpecs[index];
    await attachListener(wsContracts[label], eventName, label);
    realtimeHealth.listenersAttached = activeListeners.length;

    if (REALTIME_SUBSCRIPTION_DELAY_MS > 0 && index < listenerSpecs.length - 1) {
      await sleep(REALTIME_SUBSCRIPTION_DELAY_MS);
    }
  }

  realtimeHealth.listenersAttached = activeListeners.length;
  reconnecting = false;

  try {
    await currentWsProvider.getBlockNumber();
    realtimeHealth.connected = true;
    realtimeHealth.lastConnectedAt = new Date();
    realtimeHealth.lastError = '';
    realtimeHealth.reconnectAttempt = 0;
  } catch (error) {
    realtimeHealth.lastError = buildErrorMessage(error);
    throw error;
  }

  console.log('[REALTIME_EVENT_INDEXER_CONNECTED]', {
    url: wsUrl,
    index: realtimeHealth.currentWsIndex,
    listeners: activeListeners.length,
  });
}

export async function startRealtimeEventIndexer() {
  if (realtimeStarted) {
    return {
      ok: true,
      alreadyStarted: true,
      listeners: activeListeners.length,
    };
  }

  realtimeStarted = true;
  stopping = false;
  realtimeHealth.running = true;

  try {
    await connectRealtimeProvider();
  } catch (error) {
    realtimeHealth.lastError = buildErrorMessage(error);
    console.error('[REALTIME_EVENT_INDEXER_BOOTSTRAP_FAILED]', {
      message: buildErrorMessage(error),
    });
    await cleanupRealtimeProvider();
    scheduleReconnect(error);
  }

  console.log('[REALTIME_EVENT_INDEXER_STARTED]', {
      listeners: activeListeners.length,
    });

  return {
    ok: true,
    listeners: activeListeners.length,
  };

}

export async function stopRealtimeEventIndexer() {
  stopping = true;
  realtimeStarted = false;
  reconnecting = false;
  realtimeHealth.running = false;
  realtimeHealth.connected = false;
  realtimeHealth.lastDisconnectedAt = new Date();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  eventQueue.length = 0;
  updateQueueHealth();
  await cleanupRealtimeProvider();

  console.log('[REALTIME_EVENT_INDEXER_STOPPED]');

  return {
    ok: true,
  };
}

export function getRealtimeEventIndexerHealth() {
  return {
    ...realtimeHealth,
    reconnecting,
    queueDepth: eventQueue.length,
    activeSaves: activeEventSaves,
  };
}














// import { Contract, WebSocketProvider } from 'ethers';
// import env from '../config/env.js';
// import { safeRpcCall } from '../blockchain/provider.js';
// import { getContracts } from '../blockchain/contracts.js';

// import {
//   getBlockCached,
//   saveReceiptLog,
//   saveRegistrationLog,
//   saveOrbitLog,
//   saveTokenLog,
//   saveEscrowLog,
//   saveActivationSummaryLog,
// } from './indexerService.js';

// let realtimeStarted = false;
// let activeListeners = [];



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


// async function getChainId() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   return Number(network.chainId);
// }

// function normalizeLog(eventPayload) {
//   const log = eventPayload?.log || eventPayload;

//   return {
//     ...log,
//     index: Number(log?.index ?? log?.logIndex ?? -1),
//     logIndex: Number(log?.index ?? log?.logIndex ?? -1),
//   };
// }

// function getOrbitType(label) {
//   if (label === 'p4Orbit') return 'P4';
//   if (label === 'p12Orbit') return 'P12';
//   if (label === 'p39Orbit') return 'P39';
//   return null;
// }

// let stableWsProvider = null;

// function getStableWsProvider() {
//   if (stableWsProvider) return stableWsProvider;

//   const wsUrls = String(env.WS_RPC_URLS || '')
//     .split(',')
//     .map((url) => url.trim())
//     .filter(Boolean);

//   if (wsUrls.length === 0) {
//     throw new Error('WS_RPC_URLS is not configured');
//   }

//   stableWsProvider = new WebSocketProvider(wsUrls[0], {
//     chainId: Number(env.CHAIN_ID),
//     name: `chain-${env.CHAIN_ID}`,
//   });

//   console.log('[REALTIME_STABLE_WS_CREATED]', { url: wsUrls[0] });

//   return stableWsProvider;
// }

// function getWsContract(httpContract) {
//   const wsProvider = getStableWsProvider();
//   return new Contract(httpContract.target, httpContract.interface, wsProvider);
// }

// function attachListener(contract, eventName, label) {
//   if (!contract) return;

//   const handler = async (...args) => {
//   const eventPayload = args[args.length - 1];
//   const log = normalizeLog(eventPayload);

//   console.log('[REALTIME_EVENT_RECEIVED]', {
//     label,
//     eventName,
//     blockNumber: Number(log?.blockNumber || 0),
//     txHash: log?.transactionHash || '',
//     logIndex: Number(log?.index ?? -1),
//   });

//   try {
//     const chainId = await getChainId();
//     const block = await getBlockCached(log.blockNumber);

//     if (!block) {
//       throw new Error(`[REALTIME_MISSING_BLOCK] ${eventName} ${log.transactionHash}:${log.index}`);
//     }

//     const parsed = contract.interface.parseLog(log);

//     if (!parsed) {
//       return;
//     }

//     if (
//       label === 'registration' &&
//       ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
//     ) {
//       await saveRegistrationLog(chainId, contract.target, log, parsed, block);
//     }

//     if (label === 'levelManager') {
//       if (parsed.name === 'DetailedPayoutReceiptRecorded') {
//         await saveReceiptLog(chainId, log, parsed, block);
//       }

//       if (parsed.name === 'ActivationFinancialSummaryRecorded') {
//         await saveActivationSummaryLog(chainId, log, parsed, block);
//       }
//     }

//     if (
//       label === 'autoUpgradeEscrow' &&
//       ['EscrowLocked', 'EscrowUsedForUpgrade', 'EscrowReleasedToUser'].includes(parsed.name)
//     ) {
//       await saveEscrowLog(chainId, contract.target, log, parsed, block);
//     }

//     if (label === 'fgtToken' || label === 'fgtrToken') {
//       if (['UtilityMinted', 'UtilityBurned', 'UtilityLocked'].includes(parsed.name)) {
//         const symbol = label === 'fgtToken' ? 'FGT' : 'FGTr';
//         await saveTokenLog(chainId, symbol, log, parsed, block);
//       }
//     }

//     const orbitType = getOrbitType(label);

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
//         'PositionActivationLinked',
//         'OrbitDependencyUpdated',
//       ].includes(parsed.name)
//     ) {
//       await saveOrbitLog(chainId, orbitType, contract.target, log, parsed, block);
//     }

//     console.log('[REALTIME_EVENT_SAVED]', {
//       label,
//       eventName: parsed.name,
//       txHash: log.transactionHash,
//       logIndex: log.index,
//       blockNumber: log.blockNumber,
//     });
//   } catch (error) {
//     console.error('[REALTIME_EVENT_SAVE_FAILED]', {
//       label,
//       eventName,
//       txHash: log?.transactionHash || '',
//       logIndex: Number(log?.index ?? -1),
//       message: buildErrorMessage(error),
//     });
//   }
// };

//   contract.on(eventName, handler);

//   activeListeners.push({
//     contract,
//     eventName,
//     handler,
//     label,
//   });

//   console.log('[REALTIME_LISTENER_ATTACHED]', {
//     label,
//     eventName,
//     address: contract.target,
//   });
// }

// export async function startRealtimeEventIndexer() {
//   if (realtimeStarted) {
//     return {
//       ok: true,
//       alreadyStarted: true,
//       listeners: activeListeners.length,
//     };
//   }

//   realtimeStarted = true;

//   const contracts = getContracts();

//   const wsContracts = {
//     registration: getWsContract(contracts.registration),
//     levelManager: getWsContract(contracts.levelManager),
//     autoUpgradeEscrow: getWsContract(contracts.autoUpgradeEscrow || contracts.escrow),
//     p4Orbit: getWsContract(contracts.p4Orbit),
//     p12Orbit: getWsContract(contracts.p12Orbit),
//     p39Orbit: getWsContract(contracts.p39Orbit),
//     fgtToken: getWsContract(contracts.fgtToken),
//     fgtrToken: getWsContract(contracts.fgtrToken)
//   };

//   if (!wsContracts.registration && !wsContracts.levelManager) {
//     console.warn('[REALTIME_EVENT_INDEXER_NO_WS_PROVIDER]');
//     return {
//       ok: false,
//       listeners: 0,
//       message: 'No WebSocket provider available',
//     };
//   }

//   attachListener(wsContracts.registration, 'Registered', 'registration');
//   attachListener(wsContracts.registration, 'LevelActivated', 'registration');

//   attachListener(wsContracts.levelManager, 'DetailedPayoutReceiptRecorded', 'levelManager');
//   attachListener(wsContracts.levelManager, 'ActivationFinancialSummaryRecorded', 'levelManager');
//   attachListener(wsContracts.levelManager, 'FounderRepActivated', 'levelManager');


//   attachListener(wsContracts.autoUpgradeEscrow, 'EscrowLocked', 'autoUpgradeEscrow');
//   attachListener(wsContracts.autoUpgradeEscrow, 'EscrowUsedForUpgrade', 'autoUpgradeEscrow');
//   attachListener(wsContracts.autoUpgradeEscrow, 'EscrowReleasedToUser', 'autoUpgradeEscrow');

//   for (const [label, contract] of [
//     ['p4Orbit', wsContracts.p4Orbit],
//     ['p12Orbit', wsContracts.p12Orbit],
//     ['p39Orbit', wsContracts.p39Orbit],
//   ]) {
//     attachListener(contract, 'PositionFilled', label);
//     attachListener(contract, 'OrbitReset', label);
//     attachListener(contract, 'LinePaymentTracked', label);
//     attachListener(contract, 'PaymentRuleApplied', label);
//     attachListener(contract, 'SpilloverPaid', label);
//     attachListener(contract, 'EscrowUpdated', label);
//     attachListener(contract, 'AutoUpgradeTriggered', label);
//     attachListener(contract, 'PositionActivationLinked', label);
//     attachListener(contract, 'OrbitDependencyUpdated', label);
//   }

//   console.log('[REALTIME_EVENT_INDEXER_STARTED]', {
//     listeners: activeListeners.length,
//   });


//    for (const label of ['fgtToken', 'fgtrToken']) {
//     const contract = wsContracts[label];
//     if (contract) {
//       attachListener(contract, 'UtilityMinted', label);
//       attachListener(contract, 'UtilityBurned', label);
//       attachListener(contract, 'UtilityLocked', label);
//     }
//   }

//   return {
//     ok: true,
//     listeners: activeListeners.length,
//   };

// }

// export function stopRealtimeEventIndexer() {
//   for (const item of activeListeners) {
//     try {
//       item.contract.off(item.eventName, item.handler);
//     } catch (error) {
//       console.error('[REALTIME_LISTENER_DETACH_FAILED]', {
//         label: item.label,
//         eventName: item.eventName,
//         message: buildErrorMessage(error),
//       });
//     }
//   }

//   activeListeners = [];
//   realtimeStarted = false;

//   console.log('[REALTIME_EVENT_INDEXER_STOPPED]');

//   return {
//     ok: true,
//   };
// }













// import { Contract, WebSocketProvider } from 'ethers';
// import env from '../config/env.js';
// import { safeRpcCall } from '../blockchain/provider.js';
// import { getContracts } from '../blockchain/contracts.js';

// import {
//   getBlockCached,
//   saveReceiptLog,
//   saveRegistrationLog,
//   saveOrbitLog,
//   saveTokenLog,
// } from './indexerService.js';

// let realtimeStarted = false;
// let activeListeners = [];



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


// async function getChainId() {
//   const network = await safeRpcCall((provider) => provider.getNetwork());
//   return Number(network.chainId);
// }

// function normalizeLog(eventPayload) {
//   const log = eventPayload?.log || eventPayload;

//   return {
//     ...log,
//     index: Number(log?.index ?? log?.logIndex ?? -1),
//     logIndex: Number(log?.index ?? log?.logIndex ?? -1),
//   };
// }

// function getOrbitType(label) {
//   if (label === 'p4Orbit') return 'P4';
//   if (label === 'p12Orbit') return 'P12';
//   if (label === 'p39Orbit') return 'P39';
//   return null;
// }


// // function getWsContract(httpContract) {
// //   const wsProvider = getWsProvider();

// //   if (!wsProvider) {
// //     return null;
// //   }

// //   return new Contract(httpContract.target, httpContract.interface, wsProvider);
// // }


// let stableWsProvider = null;

// function getStableWsProvider() {
//   if (stableWsProvider) return stableWsProvider;

//   const wsUrls = String(env.WS_RPC_URLS || '')
//     .split(',')
//     .map((url) => url.trim())
//     .filter(Boolean);

//   if (wsUrls.length === 0) {
//     throw new Error('WS_RPC_URLS is not configured');
//   }

//   stableWsProvider = new WebSocketProvider(wsUrls[0], {
//     chainId: Number(env.CHAIN_ID),
//     name: `chain-${env.CHAIN_ID}`,
//   });

//   console.log('[REALTIME_STABLE_WS_CREATED]', { url: wsUrls[0] });

//   return stableWsProvider;
// }

// function getWsContract(httpContract) {
//   const wsProvider = getStableWsProvider();
//   return new Contract(httpContract.target, httpContract.interface, wsProvider);
// }

// function attachListener(contract, eventName, label) {
//   if (!contract) return;

//   // const handler = (...args) => {
//   //   const eventPayload = args[args.length - 1];

//   //   console.log('[REALTIME_EVENT_RECEIVED]', {
//   //     label,
//   //     eventName,
//   //     blockNumber: Number(eventPayload?.log?.blockNumber || eventPayload?.blockNumber || 0),
//   //     txHash: eventPayload?.log?.transactionHash || eventPayload?.transactionHash || '',
//   //     logIndex: Number(eventPayload?.log?.index ?? eventPayload?.logIndex ?? -1),
//   //   });

//   //   // For now: detection only.
//   //   // Next step: we will safely save this event using existing indexer logic.
//   // };



//   const handler = async (...args) => {
//   const eventPayload = args[args.length - 1];
//   const log = normalizeLog(eventPayload);

//   console.log('[REALTIME_EVENT_RECEIVED]', {
//     label,
//     eventName,
//     blockNumber: Number(log?.blockNumber || 0),
//     txHash: log?.transactionHash || '',
//     logIndex: Number(log?.index ?? -1),
//   });

//   try {
//     const chainId = await getChainId();
//     const block = await getBlockCached(log.blockNumber);

//     if (!block) {
//       throw new Error(`[REALTIME_MISSING_BLOCK] ${eventName} ${log.transactionHash}:${log.index}`);
//     }

//     const parsed = contract.interface.parseLog(log);

//     if (!parsed) {
//       return;
//     }

//     if (label === 'registration' && ['Registered', 'LevelActivated'].includes(parsed.name)) {
//       await saveRegistrationLog(chainId, contract.target, log, parsed, block);
//     }

//     if (label === 'levelManager' && parsed.name === 'DetailedPayoutReceiptRecorded') {
//       await saveReceiptLog(chainId, log, parsed, block);
//     }

//     if (label === 'fgtToken' || label === 'fgtrToken') {
//       if (['UtilityMinted', 'UtilityBurned', 'UtilityLocked'].includes(parsed.name)) {
//         const symbol = label === 'fgtToken' ? 'FGT' : 'FGTr';
//         await saveTokenLog(chainId, symbol, log, parsed, block);
//       }
//     }

//     const orbitType = getOrbitType(label);

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
//       await saveOrbitLog(chainId, orbitType, contract.target, log, parsed, block);
//     }

//     console.log('[REALTIME_EVENT_SAVED]', {
//       label,
//       eventName: parsed.name,
//       txHash: log.transactionHash,
//       logIndex: log.index,
//       blockNumber: log.blockNumber,
//     });
//   } catch (error) {
//     console.error('[REALTIME_EVENT_SAVE_FAILED]', {
//       label,
//       eventName,
//       txHash: log?.transactionHash || '',
//       logIndex: Number(log?.index ?? -1),
//       message: buildErrorMessage(error),
//     });
//   }
// };

//   contract.on(eventName, handler);

//   activeListeners.push({
//     contract,
//     eventName,
//     handler,
//     label,
//   });

//   console.log('[REALTIME_LISTENER_ATTACHED]', {
//     label,
//     eventName,
//     address: contract.target,
//   });
// }

// export async function startRealtimeEventIndexer() {
//   if (realtimeStarted) {
//     return {
//       ok: true,
//       alreadyStarted: true,
//       listeners: activeListeners.length,
//     };
//   }

//   realtimeStarted = true;

//   const contracts = getContracts();

//   const wsContracts = {
//     registration: getWsContract(contracts.registration),
//     levelManager: getWsContract(contracts.levelManager),
//     p4Orbit: getWsContract(contracts.p4Orbit),
//     p12Orbit: getWsContract(contracts.p12Orbit),
//     p39Orbit: getWsContract(contracts.p39Orbit),
//     fgtToken: getWsContract(contracts.fgtToken),   // <--- ADD THIS
//     fgtrToken: getWsContract(contracts.fgtrToken)
//   };

//   if (!wsContracts.registration && !wsContracts.levelManager) {
//     console.warn('[REALTIME_EVENT_INDEXER_NO_WS_PROVIDER]');
//     return {
//       ok: false,
//       listeners: 0,
//       message: 'No WebSocket provider available',
//     };
//   }

//   attachListener(wsContracts.registration, 'Registered', 'registration');
//   attachListener(wsContracts.registration, 'LevelActivated', 'registration');
// //   attachListener(wsContracts.registration, 'FounderRepActivated', 'registration');

//   attachListener(wsContracts.levelManager, 'DetailedPayoutReceiptRecorded', 'levelManager');

//   for (const [label, contract] of [
//     ['p4Orbit', wsContracts.p4Orbit],
//     ['p12Orbit', wsContracts.p12Orbit],
//     ['p39Orbit', wsContracts.p39Orbit],
//   ]) {
//     attachListener(contract, 'PositionFilled', label);
//     attachListener(contract, 'OrbitReset', label);
//     attachListener(contract, 'LinePaymentTracked', label);
//     attachListener(contract, 'PaymentRuleApplied', label);
//     attachListener(contract, 'SpilloverPaid', label);
//     attachListener(contract, 'EscrowUpdated', label);
//     attachListener(contract, 'AutoUpgradeTriggered', label);
//   }

//   console.log('[REALTIME_EVENT_INDEXER_STARTED]', {
//     listeners: activeListeners.length,
//   });


//    for (const label of ['fgtToken', 'fgtrToken']) {
//     const contract = wsContracts[label];
//     if (contract) {
//       attachListener(contract, 'UtilityMinted', label);
//       attachListener(contract, 'UtilityBurned', label);
//       attachListener(contract, 'UtilityLocked', label);
//     }
//   }

//   return {
//     ok: true,
//     listeners: activeListeners.length,
//   };

// }

// export function stopRealtimeEventIndexer() {
//   for (const item of activeListeners) {
//     try {
//       item.contract.off(item.eventName, item.handler);
//     } catch (error) {
//       console.error('[REALTIME_LISTENER_DETACH_FAILED]', {
//         label: item.label,
//         eventName: item.eventName,
//         message: buildErrorMessage(error),
//       });
//     }
//   }

//   activeListeners = [];
//   realtimeStarted = false;

//   console.log('[REALTIME_EVENT_INDEXER_STOPPED]');

//   return {
//     ok: true,
//   };
// }
