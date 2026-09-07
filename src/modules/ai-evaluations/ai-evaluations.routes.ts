import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './ai-evaluations.controller.js';
import { ApplicationIdParamSchema } from './ai-evaluations.schema.js';

/**
 * AI evaluation routes.
 * - aiEvaluationsRouter: /api/ai-evaluations (status probe).
 * - applicationAiEvaluationsRouter: /api/job-posts/applications (trigger + history
 *   as application sub-resources). Mounted BEFORE the job-posts router; auth is
 *   declared per-route so non-matching application paths fall through untouched.
 * Trigger = RH/DIRECTION; read = RH/MANAGER/DIRECTION (see docs/rbac-matrix.md).
 */

export const aiEvaluationsRouter = Router();

aiEvaluationsRouter.get(
  '/status',
  auth,
  rbac('RH', 'MANAGER', 'DIRECTION'),
  asyncHandler(controller.getStatus),
);

export const applicationAiEvaluationsRouter = Router();

// Each trigger is a paid LLM call that forwards CV content — cap per USER
// (not per IP), well below the global /api limiter. Runs after auth.
const triggerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
});

applicationAiEvaluationsRouter.post(
  '/:id/ai-evaluations',
  auth,
  rbac('RH', 'DIRECTION'),
  triggerLimiter,
  validate({ params: ApplicationIdParamSchema }),
  asyncHandler(controller.triggerEvaluation),
);

applicationAiEvaluationsRouter.get(
  '/:id/ai-evaluations',
  auth,
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: ApplicationIdParamSchema }),
  asyncHandler(controller.listEvaluations),
);
