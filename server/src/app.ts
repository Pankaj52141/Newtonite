import express from 'express';
import cors from 'cors';
import {
  requestIdMiddleware,
  requestLogger,
  authMiddleware,
  errorHandler,
} from './middleware';
import apiRoutes from './routes/api';

export function createApp() {
  const app = express();

  // ─── Global Middleware ───────────────────────────────────────
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // ─── Health Check (no auth required) ────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── API Routes (auth required) ────────────────────────────
  app.use('/api', authMiddleware, apiRoutes);

  // ─── Error Handler ─────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
