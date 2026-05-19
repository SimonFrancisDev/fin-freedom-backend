import http from 'http';
import app from './app.js';
import { connectDB } from './config/db.js';
import { connectBlockchain } from './blockchain/provider.js';
import { verifyContracts } from './blockchain/contracts.js';
import { startIndexer, stopIndexer } from './services/indexerService.js';
import {
  startRealtimeEventIndexer,
  stopRealtimeEventIndexer,
} from './services/realtimeEventIndexer.js';
import {
  startNotificationDeliveryWorker,
  stopNotificationDeliveryWorker,
} from './services/notifications/notificationDeliveryWorker.js';
import env from './config/env.js';

async function startServer() {
  try {
    await connectDB();

    const rpcInfo = await connectBlockchain();
    console.log('RPC connected:', rpcInfo);

    const contracts = await verifyContracts();
    console.log('Contracts verified:');
    console.log(contracts);

    const server = http.createServer(app);

    server.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
      console.log(`Indexer enabled: ${env.RUN_INDEXER}`);
    });

    server.on('error', (error) => {
      console.error('HTTP server error:', error);
      process.exit(1);
    });

    // if (env.RUN_INDEXER) {
    //   startIndexer().catch((error) => {
    //     console.error('Indexer startup error:', error);
    //   });
    // } else {
    //   console.log('Indexer not started in this process.');
    // }

    if (env.RUN_INDEXER) {
      startRealtimeEventIndexer().catch((error) => {
        console.error('Realtime event indexer startup error:', error);
      });

      startIndexer({ processRole: 'server' }).catch((error) => {
        console.error('Indexer startup error:', error);
      });
    } else {
      console.log('Indexer not started in this process.');
    }

    startNotificationDeliveryWorker();

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down gracefully...`);
      await stopRealtimeEventIndexer();
      await stopIndexer();
      stopNotificationDeliveryWorker();
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
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
// // import { startIndexer } from './services/read/indexerService.js'
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
//       console.log(`Indexer enabled: ${env.RUN_INDEXER}`);
//     });

//     if (env.RUN_INDEXER) {
//       startIndexer().catch((error) => {
//         console.error('Indexer startup error:', error);
//       });
//     } else {
//       console.log('Indexer not started in this process.');
//     }
//   } catch (error) {
//     console.error('Failed to start server:', error);
//     process.exit(1);
//   }
// }

// startServer();
