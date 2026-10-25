const dotenv = require('dotenv');
dotenv.config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./pool');
const authRoutes = require('./auth-routes');
const groupRoutes = require('./group-routes');
const contributionRoutes = require('./contribution-routes');
const { callbackRouter: paymentCallbackRoutes, paymentRouter } = require('./payment-routes');
const slotRoutes = require('./slot-routes');
const adminRoutes = require('./admin-routes');
const { runMigrations } = require('./migrate');

const port = Number(process.env.PORT) || 5000;
const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  }));
  app.use(express.json({ limit: '20kb', strict: true }));
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
  }));

  app.get('/api/health', async (req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/groups/:groupId/contributions', contributionRoutes);
  app.use('/api/groups/:groupId/contributions', paymentRouter);
  app.use('/api/payments/daraja', paymentCallbackRoutes);
  app.use('/api/groups/:groupId', slotRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.' });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'This change conflicts with related group records.' });
    }
    console.error('API error:', error);
    return res.status(500).json({ error: 'A server error prevented this request from completing.' });
  });

  return app;
}

async function start() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 bytes in backend/.env.');
  }
  await runMigrations();
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`ChamaFlow API listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error('Could not start ChamaFlow API:', error);
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { createApp, start };
