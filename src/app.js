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
import adminCommunityRoutes from './routes/adminCommunityRoutes.js'
import supportRoutes from './routes/supportRoutes.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));


app.use(
  rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    max: env.API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'FinFreedom backend is running',
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

  res.status(err.status || 500).json({
    ok: false,
    message: err.message || 'Internal server error',
  });
});

export default app;