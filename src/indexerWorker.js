import { connectDB } from './config/db.js';
import { connectBlockchain } from './blockchain/provider.js';
import { verifyContracts } from './blockchain/contracts.js';
import { startIndexer } from './services/indexerService.js';

async function startWorker() {
  try {
    await connectDB();

    const rpcInfo = await connectBlockchain();
    console.log('Indexer worker RPC connected:', rpcInfo);

    const contracts = await verifyContracts();
    console.log('Indexer worker contracts verified:');
    console.log(contracts);

    await startIndexer();
    console.log('Indexer worker started successfully.');
  } catch (error) {
    console.error('Indexer worker failed to start:', error);
    process.exit(1);
  }
}

startWorker();