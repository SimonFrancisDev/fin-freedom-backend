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
    lower.includes('throughput') ||
    lower.includes('compute units per second') ||
    lower.includes('rate limit')
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

async function getBlockCached(provider, blockNumber) {
  const key = Number(blockNumber);

  if (blockCache.has(key)) {
    return blockCache.get(key);
  }

  // const block = await provider.getBlock(blockNumber);
  const blcok = await safeRpcCall(() => provider.getBlock(blockNumber))

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

  const result = await IndexedReceipt.updateOne(
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

  console.log(
    `[Indexer][Receipt Saved] tx=${log.transactionHash} logIndex=${log.index} event=${parsed.name} upserted=${result.upsertedCount} modified=${result.modifiedCount}`
  );
}


async function saveRegistrationLog(chainId, contractAddress, log, parsed, block) {
  const args = parsed.args || {};

  const result = await IndexedRegistrationEvent.updateOne(
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

  console.log(
    `[Indexer][Registration Saved] tx=${log.transactionHash} logIndex=${log.index} event=${parsed.name} upserted=${result.upsertedCount} modified=${result.modifiedCount}`
  );
}

async function saveOrbitLog(chainId, orbitType, contractAddress, log, parsed, block) {
  const args = parsed.args || {};

  const result = await IndexedOrbitEvent.updateOne(
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

  console.log(
    `[Indexer][Orbit Saved] orbit=${orbitType} tx=${log.transactionHash} logIndex=${log.index} event=${parsed.name} upserted=${result.upsertedCount} modified=${result.modifiedCount}`
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
  console.log(
    `[Indexer] scanning ${contractKey} blocks ${fromBlock}-${toBlock} address=${contractAddress}`
  );

  // const logs = await provider.getLogs({
  //   address: contractAddress,
  //   fromBlock,
  //   toBlock,
  // });

  const logs = await safeRpcCall(() => 
    provider.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
    })
  )

  console.log(
    `[Indexer] ${contractKey} raw logs found: ${logs.length} in blocks ${fromBlock}-${toBlock}`
  );

  let parsedCount = 0;
  let savedReceipts = 0;
  let savedOrbitEvents = 0;

  for (const log of logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch (error) {
      console.warn(
        `[Indexer] ${contractKey} parse exception at block ${log.blockNumber}, tx ${log.transactionHash}`
      );
      continue;
    }

    if (!parsed) {
      console.warn(
        `[Indexer] ${contractKey} parseLog returned null at block ${log.blockNumber}, tx ${log.transactionHash}`
      );
      continue;
    }

    parsedCount += 1;

    console.log(
      `[Indexer] ${contractKey} parsed event=${parsed.name} tx=${log.transactionHash} block=${log.blockNumber}`
    );

    const block = await getBlockCached(provider, log.blockNumber);
    if (!block) {
      console.warn(
        `[Indexer] ${contractKey} missing block data for block ${log.blockNumber}`
      );
      continue;
    }

    if (
        contractKey === 'registration' &&
        ['Registered', 'LevelActivated', 'FounderRepActivated'].includes(parsed.name)
      ) {
        await saveRegistrationLog(chainId, contractAddress, log, parsed, block);
        continue;
      }

    if (contractKey === 'levelManager' && parsed.name === 'DetailedPayoutReceiptRecorded') {
      await saveReceiptLog(chainId, log, parsed, block);
      savedReceipts += 1;
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
      savedOrbitEvents += 1;
      continue;
    }

    console.log(
      `[Indexer] ${contractKey} parsed but not saved: event=${parsed.name} tx=${log.transactionHash}`
    );
  }

  console.log(
    `[Indexer] ${contractKey} summary for ${fromBlock}-${toBlock}: parsed=${parsedCount}, receiptsSaved=${savedReceipts}, orbitEventsSaved=${savedOrbitEvents}`
  );
}

export async function runIndexerOnce() {
  const provider = getProvider();
  const contracts = getContracts();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  const starts = getStartBlocks();
  const sync = getSyncConfig();

  console.log('indexer start block', starts);
  console.log('indexer sync config', sync);

  const latestBlock = await provider.getBlockNumber();
  const safeBlock = Math.max(0, latestBlock - sync.confirmations);

  const targets = [
    {
      key: 'registration',
      contract: contracts.registration,
      address: contracts.registration.target,
      startBlock: starts.registration ?? starts.levelManager ?? 0,
      orbitType: null,
    },
    {
      key: 'levelManager',
      contract: contracts.levelManager,
      address: contracts.levelManager.target,
      startBlock: starts.levelManager,
      orbitType: null,
    },
    {
      key: 'p4Orbit',
      contract: contracts.p4Orbit,
      address: contracts.p4Orbit.target,
      startBlock: starts.p4Orbit,
      orbitType: 'P4',
    },
    {
      key: 'p12Orbit',
      contract: contracts.p12Orbit,
      address: contracts.p12Orbit.target,
      startBlock: starts.p12Orbit,
      orbitType: 'P12',
    },
    {
      key: 'p39Orbit',
      contract: contracts.p39Orbit,
      address: contracts.p39Orbit.target,
      startBlock: starts.p39Orbit,
      orbitType: 'P39',
    },
  ];

  for (const target of targets) {
    const state = await getOrCreateSyncState(target.key, target.startBlock);

    let nextFrom = state.lastProcessedBlock + 1;
    if (nextFrom === 1 && target.startBlock > 0) {
      nextFrom = target.startBlock;
    }

    if (nextFrom > safeBlock) {
      await SyncState.updateOne(
        { key: target.key },
        {
          $set: {
            status: 'idle',
            lastSyncedAt: new Date(),
            errorMessage: '',
          },
        }
      );
      continue;
    }

    await SyncState.updateOne(
      { key: target.key },
      {
        $set: {
          status: 'running',
          errorMessage: '',
        },
      }
    );

    try {
      let fromBlock = nextFrom;
      let activeChunkSize = sync.chunkSize;
      activeChunkSize = Math.min(activeChunkSize, 3)
      let retryDelayMs = 2000;

      while (fromBlock <= safeBlock) {
        await sleep(300)
        const toBlock = Math.min(fromBlock + activeChunkSize - 1, safeBlock);

        try {
          await processLogsForContract({
            provider,
            contract: target.contract,
            contractKey: target.key,
            contractAddress: target.address,
            fromBlock,
            toBlock,
            chainId,
            orbitType: target.orbitType,
          });

          await SyncState.updateOne(
            { key: target.key },
            {
              $set: {
                lastProcessedBlock: toBlock,
                status: 'running',
                lastSyncedAt: new Date(),
                errorMessage: '',
              },
            }
          );

          fromBlock = toBlock + 1;
          retryDelayMs = 2000;
        } catch (error) {
          if (isBlockRangeLimitError(error) && activeChunkSize > 1) {
            activeChunkSize = Math.max(1, Math.floor(activeChunkSize / 2));

            console.warn(
              `[Indexer] Provider block-range limit hit for ${target.key}. Reducing chunk size to ${activeChunkSize}.`
            );

            continue;
          }

          if (isRateLimitError(error)) {
            console.warn(
              `[Indexer] Rate limit hit for ${target.key} (${fromBlock}-${toBlock}). Waiting ${retryDelayMs}ms before retry.`
            );

            await sleep(retryDelayMs);
            retryDelayMs = Math.min(retryDelayMs * 2, 20000);
            continue;
          }

          throw error;
        }
      }

      await SyncState.updateOne(
        { key: target.key },
        {
          $set: {
            status: 'idle',
            lastSyncedAt: new Date(),
            errorMessage: '',
          },
        }
      );
    } catch (error) {
      await SyncState.updateOne(
        { key: target.key },
        {
          $set: {
            status: 'error',
            errorMessage: error.message || 'Unknown sync error',
          },
        }
      );
      throw error;
    }
  }
}

let pollingHandle = null;
let isRunning = false;

export async function startIndexer() {
  const { pollIntervalMs } = getSyncConfig();

  if (pollingHandle) return;

  pollingHandle = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      await runIndexerOnce();
    } catch (err) {
      console.error('Indexer error:', err);
    } finally {
      isRunning = false;
    }
  }, pollIntervalMs);

  if (!isRunning) {
    isRunning = true;
    try {
      await runIndexerOnce();
    } catch (err) {
      console.error('Initial indexer run failed:', err);
    } finally {
      isRunning = false;
    }
  }
}

export function stopIndexer() {
  if (pollingHandle) {
    clearInterval(pollingHandle);
    pollingHandle = null;
  }
}