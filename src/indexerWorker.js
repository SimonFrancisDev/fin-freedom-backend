import { connectDB } from './config/db.js';
import { connectBlockchain } from './blockchain/provider.js';
import { verifyContracts } from './blockchain/contracts.js';
import {
  replayIndexerRange,
  replayOpenGaps,
  startIndexer,
  stopIndexer,
} from './services/indexerService.js';

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    const value = rest[i + 1];
    args[key] = value;
    i += 1;
  }

  return args;
}

function requireCliValue(args, key) {
  if (!args[key]) {
    throw new Error(`[MISSING_CLI_ARG] --${key}`);
  }

  return args[key];
}

async function connectWorkerDependencies() {
  await connectDB();

  const rpcInfo = await connectBlockchain();
  console.log('Indexer worker RPC connected:', rpcInfo);

  const contracts = await verifyContracts();
  console.log('Indexer worker contracts verified:');
  console.log(contracts);
}

async function runReplayCommand(args) {
  await connectWorkerDependencies();

  if (args.command === 'replay-gap') {
    const result = await replayIndexerRange({
      targetKey: requireCliValue(args, 'target'),
      fromBlock: Number(requireCliValue(args, 'from')),
      toBlock: Number(requireCliValue(args, 'to')),
      reason: 'operator replay-gap command',
      processRole: 'worker',
    });

    console.log('[INDEXER_REPLAY_GAP_RESULT]', result);
    return;
  }

  if (args.command === 'replay-open-gaps') {
    const result = await replayOpenGaps({
      targetKey: args.target || null,
      limit: Number(args.limit || 10),
      processRole: 'worker',
    });

    console.log('[INDEXER_REPLAY_OPEN_GAPS_RESULT]', result);
    return;
  }

  throw new Error(`[UNKNOWN_INDEXER_WORKER_COMMAND] ${args.command}`);
}

async function startWorker() {
  try {
    const args = parseCliArgs(process.argv.slice(2));

    if (args.command) {
      await runReplayCommand(args);
      process.exit(0);
    }

    await connectWorkerDependencies();
    await startIndexer({ processRole: 'worker' });
    console.log('Indexer worker started successfully.');
  } catch (error) {
    console.error('Indexer worker failed to start:', error);
    process.exit(1);
  }
}

startWorker();

async function shutdown(signal) {
  console.log(`${signal} received. Stopping indexer worker...`);
  await stopIndexer();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
