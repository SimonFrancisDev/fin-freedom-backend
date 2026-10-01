import { WebSocketProvider } from 'ethers';
import env from '../config/env.js';
import { getProvider, safeRpcCall } from '../blockchain/provider.js';
import { getFreedomPlusContractEntries } from '../blockchain/freedomPlusContracts.js';
import FreedomPlusEvent from '../models/FreedomPlusEvent.js';
import FreedomPlusSyncState from '../models/FreedomPlusSyncState.js';
import {
  projectFreedomPlusEvent,
  reconcileFreedomPlusLedgerWallets,
} from './freedomPlusProjectionService.js';

function normalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/^\d+$/.test(key))
        .map(([key, nested]) => [key, normalize(nested)])
    );
  }
  return value;
}

function parsedArgs(parsed) {
  const args = {};
  parsed.fragment.inputs.forEach((input, index) => {
    args[input.name || `arg${index}`] = normalize(parsed.args[index]);
  });
  return args;
}

function indexedAddresses(args) {
  return [...new Set(
    Object.values(args)
      .filter((value) => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value))
      .map((value) => value.toLowerCase())
  )];
}

async function syncTargetsCombined(provider, chainId, entries, confirmedBlock) {
  const initialBlock = Math.max(0, Number(env.FREEDOM_PLUS_START_BLOCK));
  const targets = [];
  const checkpointBlockCache = new Map();

  for (const [contractKey, contract] of entries) {
    const state = await FreedomPlusSyncState.findOneAndUpdate(
      { chainId, contractKey },
      { $setOnInsert: { lastProcessedBlock: Math.max(0, initialBlock - 1), status: 'idle' } },
      { upsert: true, returnDocument: 'after' }
    );

    if (state.lastProcessedBlock > 0 && state.lastProcessedBlockHash) {
      let checkpointBlock = checkpointBlockCache.get(state.lastProcessedBlock);
      if (!checkpointBlock) {
        checkpointBlock = await safeRpcCall((rpc) => rpc.getBlock(state.lastProcessedBlock));
        checkpointBlockCache.set(state.lastProcessedBlock, checkpointBlock);
      }
      if (!checkpointBlock || checkpointBlock.hash.toLowerCase() !== state.lastProcessedBlockHash) {
        throw new Error(
          'Freedom-Plus reorg detected for ' + contractKey + ' at block ' +
          state.lastProcessedBlock + '; operator replay required'
        );
      }
    }

    targets.push({
      contractKey,
      contract,
      state,
      nextBlock: Math.max(initialBlock, state.lastProcessedBlock + 1),
      processed: 0,
    });
  }

  const pending = targets.filter((target) => target.nextBlock <= confirmedBlock);
  if (pending.length === 0) {
    return targets.map((target) => ({
      contractKey: target.contractKey,
      processed: 0,
      toBlock: target.state.lastProcessedBlock,
    }));
  }

  const contractKeys = pending.map((target) => target.contractKey);
  await FreedomPlusSyncState.updateMany(
    { chainId, contractKey: { $in: contractKeys } },
    { $set: { status: 'running', errorMessage: '' } }
  );

  const targetsByAddress = new Map(
    targets.map((target) => [target.contract.target.toLowerCase(), target])
  );
  let cursor = Math.min(...pending.map((target) => target.nextBlock));

  try {
    while (cursor <= confirmedBlock) {
      const toBlock = Math.min(cursor + env.SYNC_BLOCK_CHUNK_SIZE - 1, confirmedBlock);
      const logs = await safeRpcCall((rpc) => rpc.getLogs({
        address: entries.map(([, contract]) => contract.target),
        fromBlock: cursor,
        toBlock,
      }));
      logs.sort((left, right) => (
        Number(left.blockNumber) - Number(right.blockNumber) ||
        Number(left.index ?? left.logIndex) - Number(right.index ?? right.logIndex)
      ));

      const blockCache = new Map();
      for (const log of logs) {
        const target = targetsByAddress.get(String(log.address || '').toLowerCase());
        if (!target || Number(log.blockNumber) < target.nextBlock) continue;

        let parsed;
        try {
          parsed = target.contract.interface.parseLog(log);
        } catch {
          continue;
        }
        if (!parsed) continue;

        let block = blockCache.get(log.blockNumber);
        if (!block) {
          block = await safeRpcCall((rpc) => rpc.getBlock(log.blockNumber));
          if (!block) throw new Error('Missing confirmed block ' + log.blockNumber);
          blockCache.set(log.blockNumber, block);
        }

        const args = parsedArgs(parsed);
        const document = {
          chainId,
          contractKey: target.contractKey,
          contractAddress: target.contract.target.toLowerCase(),
          eventName: parsed.name,
          txHash: log.transactionHash.toLowerCase(),
          logIndex: Number(log.index ?? log.logIndex),
          blockNumber: Number(log.blockNumber),
          blockHash: log.blockHash.toLowerCase(),
          timestamp: new Date(Number(block.timestamp) * 1000),
          activationId: String(
            args.activationId || args.recycleActivationId || args.rewardId || ''
          ).toLowerCase(),
          addresses: indexedAddresses(args),
          args,
        };
        const write = await FreedomPlusEvent.updateOne(
          {
            chainId,
            contractAddress: document.contractAddress,
            txHash: document.txHash,
            logIndex: document.logIndex,
          },
          { $setOnInsert: document },
          { upsert: true }
        );

        if (write.upsertedCount > 0) {
          try {
            await projectFreedomPlusEvent(document);
          } catch (error) {
            await FreedomPlusEvent.deleteOne({
              chainId,
              contractAddress: document.contractAddress,
              txHash: document.txHash,
              logIndex: document.logIndex,
            });
            throw error;
          }
          target.processed += 1;
        }
      }

      const terminalBlock = await safeRpcCall((rpc) => rpc.getBlock(toBlock));
      if (!terminalBlock) throw new Error('Missing terminal block ' + toBlock);

      const advancedTargets = targets.filter((target) => target.nextBlock <= toBlock);
      if (advancedTargets.length > 0) {
        await FreedomPlusSyncState.updateMany(
          {
            chainId,
            contractKey: { $in: advancedTargets.map((target) => target.contractKey) },
          },
          {
            $set: {
              lastProcessedBlock: toBlock,
              lastProcessedBlockHash: terminalBlock.hash.toLowerCase(),
              status: 'running',
              lastSyncedAt: new Date(),
            },
          }
        );
        for (const target of advancedTargets) {
          target.nextBlock = toBlock + 1;
        }
      }

      cursor = toBlock + 1;
    }

    await FreedomPlusSyncState.updateMany(
      { chainId, contractKey: { $in: contractKeys } },
      { $set: { status: 'idle', errorMessage: '', lastSyncedAt: new Date() } }
    );

    return targets.map((target) => ({
      contractKey: target.contractKey,
      processed: target.processed,
      toBlock: Math.max(target.state.lastProcessedBlock, confirmedBlock),
    }));
  } catch (error) {
    await FreedomPlusSyncState.updateMany(
      { chainId, contractKey: { $in: contractKeys } },
      { $set: { status: 'error', errorMessage: String(error?.message || error) } }
    );
    throw error;
  }
}
export async function syncFreedomPlusOnce() {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false, targets: [] };
  const provider = getProvider();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== Number(env.CHAIN_ID)) {
    throw new Error(`Freedom-Plus chain mismatch: expected ${env.CHAIN_ID}, received ${chainId}`);
  }
  const head = await safeRpcCall((rpc) => rpc.getBlockNumber());
  const confirmedBlock = Math.max(0, head - env.SYNC_CONFIRMATIONS);
  const entries = getFreedomPlusContractEntries(provider);
  const targets = await syncTargetsCombined(provider, chainId, entries, confirmedBlock);
  const reconciledLedgerWallets = await reconcileFreedomPlusLedgerWallets(chainId);
  return { enabled: true, head, confirmedBlock, targets, reconciledLedgerWallets };
}

let timer = null;
let running = false;

export async function syncNftMembershipThrough(cutoffBlock) {
  if (!env.RUN_INDEXER || !env.FREEDOM_PLUS_ENABLED || running) return;
  if (!Number.isSafeInteger(cutoffBlock) || cutoffBlock < 0) throw new Error('Invalid NFT cutoff block');
  running = true;
  try {
    const provider = getProvider();
    const chainId = Number((await provider.getNetwork()).chainId);
    if (chainId !== Number(env.CHAIN_ID)) throw new Error('NFT catchup chain mismatch');
    const state = await FreedomPlusSyncState.findOne({ chainId, contractKey: 'nftMembership' }).lean();
    const start = Math.max(Number(env.FREEDOM_PLUS_START_BLOCK), Number(state?.lastProcessedBlock ?? -1) + 1);
    if (start > cutoffBlock) return;
    const head = await safeRpcCall((rpc) => rpc.getBlockNumber());
    const through = Math.min(cutoffBlock, head - env.SYNC_CONFIRMATIONS,
      start + env.SYNC_BLOCK_CHUNK_SIZE * 10 - 1);
    if (through < start) return;
    const entries = getFreedomPlusContractEntries(provider).filter(([key]) => key === 'nftMembership');
    if (entries.length !== 1) throw new Error('NFT membership contract is not configured');
    // Checkpoints advance only after actual log scans, including empty ranges.
    return await syncTargetsCombined(provider, chainId, entries, through);
  } finally {
    running = false;
  }
}

let realtimeProvider = null;
let realtimeContracts = [];
let realtimeStarted = false;
let realtimeStopping = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let wsIndex = 0;
let liveQueue = Promise.resolve();
let socketHandlers = null;
let confirmationTimer = null;
let sharedRealtimeConnection = false;

async function startupRecovery() {
  if (!env.FREEDOM_PLUS_STARTUP_REPLAY_ENABLED) {
    console.warn('[FREEDOM_PLUS_STARTUP_REPLAY_SKIPPED]');
    return null;
  }
  return scheduledPass();
}

async function scheduledPass() {
  if (running) return null;
  running = true;
  try {
    const result = await syncFreedomPlusOnce();
    if (result.enabled) {
      console.log('[FREEDOM_PLUS_INDEXER_PASS]', {
        head: result.head,
        confirmedBlock: result.confirmedBlock,
        events: result.targets.reduce((sum, target) => sum + target.processed, 0),
      });
    }
    return result;
  } catch (error) {
    console.error('[FREEDOM_PLUS_INDEXER_FAILED]', {
      message: String(error?.message || error),
    });
    return null;
  } finally {
    running = false;
  }
}

export async function startFreedomPlusIndexer(options = {}) {
  if (!env.FREEDOM_PLUS_ENABLED) return { enabled: false };
  if (env.FREEDOM_PLUS_REALTIME_ENABLED && options.sharedRealtime) {
    return startFreedomPlusSharedRealtimeIndexer();
  }
  if (env.FREEDOM_PLUS_REALTIME_ENABLED) return startFreedomPlusRealtimeIndexer();
  if (!env.FREEDOM_PLUS_POLLING_ENABLED) {
    console.warn('[FREEDOM_PLUS_INDEXER_DISABLED] No realtime or polling mode is enabled');
    return { enabled: false };
  }
  if (timer) return { enabled: true, mode: 'polling', alreadyStarted: true };
  await scheduledPass();
  timer = setInterval(scheduledPass, env.SYNC_POLL_INTERVAL_MS);
  timer.unref?.();
  return { enabled: true, mode: 'polling', intervalMs: env.SYNC_POLL_INTERVAL_MS };
}

export async function stopFreedomPlusIndexer() {
  if (timer) clearInterval(timer);
  timer = null;
  realtimeStopping = true;
  realtimeStarted = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (confirmationTimer) clearTimeout(confirmationTimer);
  confirmationTimer = null;
  if (!sharedRealtimeConnection) await cleanupRealtime();
  sharedRealtimeConnection = false;
  await liveQueue.catch(() => {});
  while (running) await new Promise((resolve) => setTimeout(resolve, 50));
}

function getSocket(provider) {
  return provider?.websocket || provider?._websocket || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queueLive(task) {
  liveQueue = liveQueue.then(task, task).catch((error) => {
    console.error('[FREEDOM_PLUS_REALTIME_EVENT_FAILED]', {
      message: String(error?.message || error),
    });
  });
  return liveQueue;
}

async function buildDocument(provider, chainId, contractKey, contract, log) {
  let parsed;
  try { parsed = contract.interface.parseLog(log); } catch { return null; }
  if (!parsed) return null;
  const block = await safeRpcCall((rpc) => rpc.getBlock(log.blockNumber));
  if (!block) throw new Error(`Missing live block ${log.blockNumber}`);
  const args = parsedArgs(parsed);
  return {
    chainId,
    contractKey,
    contractAddress: contract.target.toLowerCase(),
    eventName: parsed.name,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(log.index),
    blockNumber: Number(log.blockNumber),
    blockHash: log.blockHash.toLowerCase(),
    timestamp: new Date(Number(block.timestamp) * 1000),
    activationId: String(args.activationId || args.recycleActivationId || args.rewardId || '').toLowerCase(),
    addresses: indexedAddresses(args),
    args,
  };
}

async function ingestLiveLog(provider, chainId, contractKey, contract, log) {
  if (log.removed) throw new Error(`Removed Freedom-Plus log detected at ${log.blockNumber}`);
  const document = await buildDocument(provider, chainId, contractKey, contract, log);
  if (!document) return;
  const write = await FreedomPlusEvent.updateOne(
    {
      chainId,
      contractAddress: document.contractAddress,
      txHash: document.txHash,
      logIndex: document.logIndex,
    },
    { $setOnInsert: document },
    { upsert: true }
  );
  if (write.upsertedCount > 0) {
    try {
      await projectFreedomPlusEvent(document);
    } catch (error) {
      await FreedomPlusEvent.deleteOne({
        chainId,
        contractAddress: document.contractAddress,
        txHash: document.txHash,
        logIndex: document.logIndex,
      });
      throw error;
    }
  }
  scheduleConfirmedRecovery();
}

export function notifyFreedomPlusRealtimeEvent(contractKey, log) {
  if (log?.removed) {
    console.warn('[FREEDOM_PLUS_REALTIME_REMOVED_LOG]', {
      contractKey,
      blockNumber: Number(log.blockNumber || 0),
    });
  }
  scheduleConfirmedRecovery();
}

function scheduleConfirmedRecovery() {
  if (realtimeStopping || confirmationTimer) return;
  confirmationTimer = setTimeout(() => {
    confirmationTimer = null;
    scheduledPass().then((result) => {
      if (!result?.enabled) return;
      console.log('[FREEDOM_PLUS_REALTIME_CONFIRMED]', {
        confirmedBlock: result.confirmedBlock,
        recoveredEvents: result.targets.reduce((sum, target) => sum + target.processed, 0),
      });
    });
  }, 12000);
  confirmationTimer.unref?.();
}

function detachSocketHandlers() {
  const socket = getSocket(realtimeProvider);
  if (!socket || !socketHandlers) return;
  const method = typeof socket.removeEventListener === 'function' ? 'removeEventListener' : 'off';
  socket[method]?.('close', socketHandlers.close);
  socket[method]?.('error', socketHandlers.error);
  socketHandlers = null;
}

async function cleanupRealtime() {
  const provider = realtimeProvider;
  if (!provider) return;
  detachSocketHandlers();
  realtimeContracts = [];
  realtimeProvider = null;
  // destroy() owns subscription teardown. Calling off() immediately before it leaves
  // ethers with cancelled eth_unsubscribe requests during worker shutdown.
  try { await provider.destroy(); } catch {}
}

function scheduleRealtimeReconnect(error) {
  if (realtimeStopping || !realtimeStarted || reconnectTimer) return;
  reconnectAttempt += 1;
  const delay = Math.min(
    env.WS_RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, reconnectAttempt - 1)),
    env.WS_RECONNECT_MAX_DELAY_MS
  );
  console.warn('[FREEDOM_PLUS_REALTIME_RECONNECT_SCHEDULED]', {
    delay,
    message: String(error?.message || error || ''),
  });
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    wsIndex = (wsIndex + 1) % env.WS_RPC_URLS.length;
    try {
      await connectFreedomPlusRealtime();
    } catch (connectError) {
      await cleanupRealtime();
      scheduleRealtimeReconnect(connectError);
    }
  }, delay);
  reconnectTimer.unref?.();
}

async function connectFreedomPlusRealtime() {
  await cleanupRealtime();
  const wsUrl = env.WS_RPC_URLS[wsIndex % env.WS_RPC_URLS.length];
  const provider = new WebSocketProvider(wsUrl, {
    chainId: Number(env.CHAIN_ID),
    name: `chain-${env.CHAIN_ID}`,
  });
  realtimeProvider = provider;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== Number(env.CHAIN_ID)) {
    throw new Error(`Freedom-Plus WS chain mismatch: expected ${env.CHAIN_ID}, received ${chainId}`);
  }

  const entries = getFreedomPlusContractEntries(provider);
  for (let index = 0; index < entries.length; index += 1) {
    const [contractKey, contract] = entries[index];
    const listener = (log) => {
      if (log.removed) {
        console.warn('[FREEDOM_PLUS_REALTIME_REMOVED_LOG]', {
          contractKey,
          blockNumber: Number(log.blockNumber || 0),
        });
      }
      scheduleConfirmedRecovery();
    };
    realtimeContracts.push([contractKey, contract, listener]);
    await provider.on({ address: contract.target }, listener);

    if (index < entries.length - 1) {
      await sleep(env.REALTIME_SUBSCRIPTION_DELAY_MS);
    }
  }
  const socket = getSocket(provider);
  const disconnect = (error) => {
    cleanupRealtime().then(() => scheduleRealtimeReconnect(error));
  };
  socketHandlers = {
    close: (event) => disconnect(new Error(`WebSocket closed ${event?.code || ''}`.trim())),
    error: (error) => disconnect(error),
  };
  const method = typeof socket?.addEventListener === 'function' ? 'addEventListener' : 'on';
  socket?.[method]?.('close', socketHandlers.close);
  socket?.[method]?.('error', socketHandlers.error);

  // Subscriptions only trigger confirmed catch-up; projections never consume unconfirmed logs.
  const recovery = await startupRecovery();
  reconnectAttempt = 0;
  console.log('[FREEDOM_PLUS_REALTIME_CONNECTED]', {
    wsIndex: wsIndex % env.WS_RPC_URLS.length,
    listeners: entries.length,
    recoveredEvents: recovery?.targets?.reduce((sum, target) => sum + target.processed, 0) || 0,
    confirmedBlock: recovery?.confirmedBlock || null,
  });
}

async function startFreedomPlusSharedRealtimeIndexer() {
  if (realtimeStarted) {
    return { enabled: true, mode: 'realtime-shared', alreadyStarted: true };
  }

  realtimeStarted = true;
  realtimeStopping = false;
  sharedRealtimeConnection = true;
  const recovery = await startupRecovery();
  const listeners = getFreedomPlusContractEntries(getProvider()).length;

  console.log('[FREEDOM_PLUS_REALTIME_CONNECTED]', {
    sharedConnection: true,
    listeners,
    recoveredEvents: recovery?.targets?.reduce((sum, target) => sum + target.processed, 0) || 0,
    confirmedBlock: recovery?.confirmedBlock || null,
  });

  return {
    enabled: true,
    mode: 'realtime-shared',
    recovery: 'startup-event-confirmation-reconnect',
  };
}

async function startFreedomPlusRealtimeIndexer() {
  if (realtimeStarted) return { enabled: true, mode: 'realtime', alreadyStarted: true };
  realtimeStarted = true;
  realtimeStopping = false;

  try {
    await connectFreedomPlusRealtime();
  } catch (error) {
    await cleanupRealtime();
    scheduleRealtimeReconnect(error);
  }
  return {
    enabled: true,
    mode: 'realtime',
    recovery: 'startup-event-confirmation-reconnect',
  };
}
