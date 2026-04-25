import { Contract, WebSocketProvider } from 'ethers';
import env from '../config/env.js';
import { safeRpcCall } from '../blockchain/provider.js';
import { getContracts } from '../blockchain/contracts.js';

import {
  getBlockCached,
  saveReceiptLog,
  saveRegistrationLog,
  saveOrbitLog,
} from './indexerService.js';

let realtimeStarted = false;
let activeListeners = [];



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


// function getWsContract(httpContract) {
//   const wsProvider = getWsProvider();

//   if (!wsProvider) {
//     return null;
//   }

//   return new Contract(httpContract.target, httpContract.interface, wsProvider);
// }


let stableWsProvider = null;

function getStableWsProvider() {
  if (stableWsProvider) return stableWsProvider;

  const wsUrls = String(env.WS_RPC_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (wsUrls.length === 0) {
    throw new Error('WS_RPC_URLS is not configured');
  }

  stableWsProvider = new WebSocketProvider(wsUrls[0], {
    chainId: Number(env.CHAIN_ID),
    name: `chain-${env.CHAIN_ID}`,
  });

  console.log('[REALTIME_STABLE_WS_CREATED]', { url: wsUrls[0] });

  return stableWsProvider;
}

function getWsContract(httpContract) {
  const wsProvider = getStableWsProvider();
  return new Contract(httpContract.target, httpContract.interface, wsProvider);
}

function attachListener(contract, eventName, label) {
  if (!contract) return;

  // const handler = (...args) => {
  //   const eventPayload = args[args.length - 1];

  //   console.log('[REALTIME_EVENT_RECEIVED]', {
  //     label,
  //     eventName,
  //     blockNumber: Number(eventPayload?.log?.blockNumber || eventPayload?.blockNumber || 0),
  //     txHash: eventPayload?.log?.transactionHash || eventPayload?.transactionHash || '',
  //     logIndex: Number(eventPayload?.log?.index ?? eventPayload?.logIndex ?? -1),
  //   });

  //   // For now: detection only.
  //   // Next step: we will safely save this event using existing indexer logic.
  // };



  const handler = async (...args) => {
  const eventPayload = args[args.length - 1];
  const log = normalizeLog(eventPayload);

  console.log('[REALTIME_EVENT_RECEIVED]', {
    label,
    eventName,
    blockNumber: Number(log?.blockNumber || 0),
    txHash: log?.transactionHash || '',
    logIndex: Number(log?.index ?? -1),
  });

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

    if (label === 'registration' && ['Registered', 'LevelActivated'].includes(parsed.name)) {
      await saveRegistrationLog(chainId, contract.target, log, parsed, block);
    }

    if (label === 'levelManager' && parsed.name === 'DetailedPayoutReceiptRecorded') {
      await saveReceiptLog(chainId, log, parsed, block);
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
  } catch (error) {
    console.error('[REALTIME_EVENT_SAVE_FAILED]', {
      label,
      eventName,
      txHash: log?.transactionHash || '',
      logIndex: Number(log?.index ?? -1),
      message: buildErrorMessage(error),
    });
  }
};

  contract.on(eventName, handler);

  activeListeners.push({
    contract,
    eventName,
    handler,
    label,
  });

  console.log('[REALTIME_LISTENER_ATTACHED]', {
    label,
    eventName,
    address: contract.target,
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

  const contracts = getContracts();

  const wsContracts = {
    registration: getWsContract(contracts.registration),
    levelManager: getWsContract(contracts.levelManager),
    p4Orbit: getWsContract(contracts.p4Orbit),
    p12Orbit: getWsContract(contracts.p12Orbit),
    p39Orbit: getWsContract(contracts.p39Orbit),
  };

  if (!wsContracts.registration && !wsContracts.levelManager) {
    console.warn('[REALTIME_EVENT_INDEXER_NO_WS_PROVIDER]');
    return {
      ok: false,
      listeners: 0,
      message: 'No WebSocket provider available',
    };
  }

  attachListener(wsContracts.registration, 'Registered', 'registration');
  attachListener(wsContracts.registration, 'LevelActivated', 'registration');
//   attachListener(wsContracts.registration, 'FounderRepActivated', 'registration');

  attachListener(wsContracts.levelManager, 'DetailedPayoutReceiptRecorded', 'levelManager');

  for (const [label, contract] of [
    ['p4Orbit', wsContracts.p4Orbit],
    ['p12Orbit', wsContracts.p12Orbit],
    ['p39Orbit', wsContracts.p39Orbit],
  ]) {
    attachListener(contract, 'PositionFilled', label);
    attachListener(contract, 'OrbitReset', label);
    attachListener(contract, 'LinePaymentTracked', label);
    attachListener(contract, 'PaymentRuleApplied', label);
    attachListener(contract, 'SpilloverPaid', label);
    attachListener(contract, 'EscrowUpdated', label);
    attachListener(contract, 'AutoUpgradeTriggered', label);
  }

  console.log('[REALTIME_EVENT_INDEXER_STARTED]', {
    listeners: activeListeners.length,
  });

  return {
    ok: true,
    listeners: activeListeners.length,
  };
}

export function stopRealtimeEventIndexer() {
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
  realtimeStarted = false;

  console.log('[REALTIME_EVENT_INDEXER_STOPPED]');

  return {
    ok: true,
  };
}