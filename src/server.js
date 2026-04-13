import app from './app.js';
import { connectDB } from './config/db.js';
import { connectBlockchain } from './blockchain/provider.js';
import { verifyContracts } from './blockchain/contracts.js';
import { startIndexer } from './services/indexerService.js';
import env from './config/env.js';

async function startServer() {
  try {
    await connectDB();

    const rpcInfo = await connectBlockchain();
    console.log('RPC connected:', rpcInfo);

    const contracts = await verifyContracts();
    console.log('Contracts verified:');
    console.log(contracts);

    app.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
    });

    startIndexer().catch((error) => {
      console.error('Indexer startup error:', error);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

