import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './reporting.controller.js';
import { EmptyQuerySchema, ReportWindowQuerySchema } from './reporting.schema.js';

/**
 * Reporting routes — mounted at /api/reports. Read-only KPI/dashboard endpoints.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * GET /occupancy   RH, MANAGER, DIRECTION   (point-in-time)
 * GET /pipeline    RH, DIRECTION            (?from=&to= on Candidate.createdAt)
 * GET /missions    RH, MANAGER, DIRECTION   (?from=&to= on Mission.startDate)
 * GET /hr          RH, DIRECTION            (point-in-time)
 * GET /summary     RH, MANAGER, DIRECTION   (service filters payload by role — D2)
 * GET /me          CONSULTANT               (own dashboard; ownership via req.user.id)
 */
export const reportingRouter = Router();

// Every route is authenticated.
reportingRouter.use(auth);

reportingRouter.get(
  '/occupancy',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: EmptyQuerySchema }),
  asyncHandler(controller.getOccupancy),
);

reportingRouter.get(
  '/pipeline',
  rbac('RH', 'DIRECTION'),
  validate({ query: ReportWindowQuerySchema }),
  asyncHandler(controller.getPipeline),
);

reportingRouter.get(
  '/missions',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ReportWindowQuerySchema }),
  asyncHandler(controller.getMissions),
);

reportingRouter.get(
  '/hr',
  rbac('RH', 'DIRECTION'),
  validate({ query: EmptyQuerySchema }),
  asyncHandler(controller.getHr),
);

reportingRouter.get(
  '/summary',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: EmptyQuerySchema }),
  asyncHandler(controller.getSummary),
);

reportingRouter.get(
  '/me',
  rbac('CONSULTANT'),
  validate({ query: EmptyQuerySchema }),
  asyncHandler(controller.getMe),
);
