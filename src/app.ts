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
import { clientsRouter } from './modules/clients/clients.routes.js';
import { missionsRouter } from './modules/missions/missions.routes.js';
import { staffingRouter } from './modules/staffing/staffing.routes.js';
import { contractTemplatesRouter } from './modules/contract-templates/contract-templates.routes.js';
import { contractsRouter } from './modules/contracts/contracts.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { reportingRouter } from './modules/reporting/reporting.routes.js';
import { skillsRouter } from './modules/skills/skills.routes.js';
import { jobPostsRouter } from './modules/job-posts/job-posts.routes.js';
import { createPublicJobsRouter } from './modules/public-jobs/public-jobs.routes.js';

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

  // PUBLIC portal — mounted BEFORE the global limiter + all auth'd routes. It is
  // an isolated, unauthenticated blast radius with its OWN stricter limiters.
  // (trust proxy stays default for dev-direct; revisit per deployment topology.)
  app.use('/api/public', createPublicJobsRouter());

  // Rate limit all remaining /api traffic (does not double-cover /api/public).
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
  app.use('/api/clients', clientsRouter);
  app.use('/api/missions', missionsRouter);
  app.use('/api/staffing', staffingRouter);
  app.use('/api/contract-templates', contractTemplatesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/reports', reportingRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/job-posts', jobPostsRouter);

  // Unknown route -> 404 (handled by central error handler).
  app.use('/api', (_req, _res, next) => {
    next(AppError.notFound('Route not found'));
  });

  // Central error handler — MUST be last.
  app.use(errorHandler);

  return app;
}
