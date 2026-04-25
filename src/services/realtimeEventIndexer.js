import { Contract } from 'ethers';
import { getWsProvider, safeRpcCall } from '../blockchain/provider.js';
import { getContracts } from '../blockchain/contracts.js';

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

function getWsContract(httpContract) {
  const wsProvider = getWsProvider();

  if (!wsProvider) {
    return null;
  }

  return new Contract(httpContract.target, httpContract.interface, wsProvider);
}

function attachListener(contract, eventName, label) {
  if (!contract) return;

  const handler = (...args) => {
    const eventPayload = args[args.length - 1];

    console.log('[REALTIME_EVENT_RECEIVED]', {
      label,
      eventName,
      blockNumber: Number(eventPayload?.log?.blockNumber || eventPayload?.blockNumber || 0),
      txHash: eventPayload?.log?.transactionHash || eventPayload?.transactionHash || '',
      logIndex: Number(eventPayload?.log?.index ?? eventPayload?.logIndex ?? -1),
    });

    // For now: detection only.
    // Next step: we will safely save this event using existing indexer logic.
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