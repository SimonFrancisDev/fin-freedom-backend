import app from './app.js';
import { connectDB } from './config/db.js';
import { connectBlockchain } from './blockchain/provider.js';
import { verifyContracts } from './blockchain/contracts.js';
// import { startIndexer } from './services/read/indexerService.js'
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
      console.log(`Indexer enabled: ${env.RUN_INDEXER}`);
    });

    if (env.RUN_INDEXER) {
      startIndexer().catch((error) => {
        console.error('Indexer startup error:', error);
      });
    } else {
      console.log('Indexer not started in this process.');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();













// import app from './app.js';
// import { connectDB } from './config/db.js';
// import { connectBlockchain } from './blockchain/provider.js';
// import { verifyContracts } from './blockchain/contracts.js';
// import { startIndexer } from './services/indexerService.js';
// import env from './config/env.js';

// async function startServer() {
//   try {
//     await connectDB();

//     const rpcInfo = await connectBlockchain();
//     console.log('RPC connected:', rpcInfo);

//     const contracts = await verifyContracts();
//     console.log('Contracts verified:');
//     console.log(contracts);

//     app.listen(env.PORT, () => {
//       console.log(`Server running on port ${env.PORT}`);
//     });

//     startIndexer().catch((error) => {
//       console.error('Indexer startup error:', error);
//     });
//   } catch (error) {
//     console.error('Failed to start server:', error);
//     process.exit(1);
//   }
// }

// startServer();

