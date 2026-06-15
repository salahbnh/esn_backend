import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { AppError } from './lib/app-error.js';
import { errorHandler } from './middleware/error.js';
import { healthRouter } from './modules/health/health.routes.js';
import { recruitmentRouter } from './modules/recruitment/recruitment.routes.js';
import { consultantsRouter } from './modules/consultants/consultants.routes.js';

export function buildApp(): Express {
  const app = express();

  // Security headers.
  app.use(helmet());

  // CORS — allow only the configured frontend origin.
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
    }),
  );

  // Body parsing.
  app.use(express.json({ limit: '1mb' }));

  // Request logging.
  app.use(pinoHttp({ logger }));

  // Rate limit all /api traffic.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  // Routes.
  app.use('/api/health', healthRouter);
  app.use('/api/candidates', recruitmentRouter);
  app.use('/api/consultants', consultantsRouter);
  // Future modules mount here: /api/missions, ...

  // Unknown route -> 404 (handled by central error handler).
  app.use('/api', (_req, _res, next) => {
    next(AppError.notFound('Route not found'));
  });

  // Central error handler — MUST be last.
  app.use(errorHandler);

  return app;
}
