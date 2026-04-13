import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import env from './config/env.js';

import healthRoutes from './routes/healthRoutes.js';
import indexerRoutes from './routes/indexerRoutes.js';
import receiptRoutes from './routes/receiptRoutes.js';
import orbitEventRoutes from './routes/orbitEventRoutes.js';
import orbitRoutes from './routes/orbitRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import adminCommunityRoutes from './routes/adminCommunityRoutes.js';
import supportRoutes from './routes/supportRoutes.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://fin-freedom-backend-3.onrender.com',
  'https://ffn-backend-qx15.onrender.com',
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, true);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', env.ADMIN_API_HEADER || 'x-admin-key'],
  })
);

app.options('*', cors());

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    max: env.API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      message: 'Too many requests. Please try again shortly.',
    },
    skip: (req) => req.path === '/api/health' || req.path === '/',
  })
);

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'FinFreedom backend is running',
    indexerEnabled: env.RUN_INDEXER,
  });
});

app.use('/api/health', healthRoutes);
app.use('/api/indexer', indexerRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/orbit-events', orbitEventRoutes);
app.use('/api/orbits', orbitRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/admin/community', adminCommunityRoutes);
app.use('/api/support', supportRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Route not found',
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  const status = err.status || 500;
  const message =
    status >= 500 && env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';

  res.status(status).json({
    ok: false,
    message,
  });
});

export default app;














// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import morgan from 'morgan';
// import rateLimit from 'express-rate-limit';
// import env from './config/env.js';

// import healthRoutes from './routes/healthRoutes.js';
// import indexerRoutes from './routes/indexerRoutes.js';
// import receiptRoutes from './routes/receiptRoutes.js';
// import orbitEventRoutes from './routes/orbitEventRoutes.js';
// import orbitRoutes from './routes/orbitRoutes.js';
// import communityRoutes from './routes/communityRoutes.js';
// import adminCommunityRoutes from './routes/adminCommunityRoutes.js';
// import supportRoutes from './routes/supportRoutes.js';

// const app = express();

// app.set('trust proxy', 1);

// app.use(helmet());
// app.use(cors());
// app.use(express.json({ limit: '2mb' }));
// app.use(express.urlencoded({ extended: true }));

// app.use(
//   rateLimit({
//     windowMs: env.API_RATE_LIMIT_WINDOW_MS,
//     max: env.API_RATE_LIMIT_MAX,
//     standardHeaders: true,
//     legacyHeaders: false,
//     message: {
//       ok: false,
//       message: 'Too many requests. Please try again shortly.',
//     },
//   })
// );

// app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// app.get('/', (req, res) => {
//   res.status(200).json({
//     ok: true,
//     message: 'FinFreedom backend is running',
//     indexerEnabled: env.RUN_INDEXER,
//   });
// });

// app.use('/api/health', healthRoutes);
// app.use('/api/indexer', indexerRoutes);
// app.use('/api/receipts', receiptRoutes);
// app.use('/api/orbit-events', orbitEventRoutes);
// app.use('/api/orbits', orbitRoutes);
// app.use('/api/community', communityRoutes);
// app.use('/api/admin/community', adminCommunityRoutes);
// app.use('/api/support', supportRoutes);

// app.use((req, res) => {
//   res.status(404).json({
//     ok: false,
//     message: 'Route not found',
//   });
// });

// app.use((err, req, res, next) => {
//   console.error(err);

//   const status = err.status || 500;
//   const message =
//     status >= 500 && env.NODE_ENV === 'production'
//       ? 'Internal server error'
//       : err.message || 'Internal server error';

//   res.status(status).json({
//     ok: false,
//     message,
//   });
// });

// export default app;
