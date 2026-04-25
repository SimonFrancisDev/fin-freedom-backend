import mongoose from 'mongoose';
import env from '../config/env.js';

export async function getHealth(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');

    res.status(200).json({
      ok: true,
      service: 'finfreedom-backend',
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      db: {
        readyState: mongoose.connection.readyState,
      },
      indexer: {
        enabled: env.RUN_INDEXER,
      },
    });
  } catch (error) {
    next(error);
  }
}










// import env from '../config/env.js';

// export async function getHealth(req, res, next) {
//   try {
//     res.status(200).json({
//       ok: true,
//       service: 'finfreedom-backend',
//       env: env.NODE_ENV,
//       timestamp: new Date().toISOString(),
//     });
//   } catch (error) {
//     next(error);
//   }
// }