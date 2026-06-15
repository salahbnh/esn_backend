import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac, requireOwnershipFor } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './missions.controller.js';
import * as missionsService from './missions.service.js';
import {
  CreateAmendmentBodySchema,
  CreateMissionBodySchema,
  IdParamSchema,
  ListMissionsQuerySchema,
  MissionStatusTransitionBodySchema,
  PaginationQuerySchema,
  UpdateMissionBodySchema,
} from './missions.schema.js';

/**
 * Missions routes — mounted at /api/missions.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * POST   /                  MANAGER, DIRECTION
 * GET    /                  RH, MANAGER, DIRECTION
 * GET    /:id               RH, MANAGER, DIRECTION; CONSULTANT (own assigned only)
 * PATCH  /:id               MANAGER, DIRECTION
 * PATCH  /:id/status        MANAGER, DIRECTION
 * PATCH  /:id/archive       MANAGER, DIRECTION
 * POST   /:id/amendments    MANAGER, DIRECTION
 * GET    /:id/amendments    RH, MANAGER, DIRECTION
 *
 * The CONSULTANT own-mission read is gated by `requireOwnershipFor('CONSULTANT',
 * resolver)` using the MISSIONS-owned resolver (so missions never imports
 * staffing). The resolver returns the owning userId iff the caller has an
 * assignment on the mission — resolved from the DB, never trusting the request.
 */
export const missionsRouter = Router();

// Every route is authenticated.
missionsRouter.use(auth);

// --- List + create ---------------------------------------------------------

missionsRouter.post(
  '/',
  rbac('MANAGER', 'DIRECTION'),
  validate({ body: CreateMissionBodySchema }),
  asyncHandler(controller.createMission),
);

missionsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListMissionsQuerySchema }),
  asyncHandler(controller.listMissions),
);

// --- Amendments (declared before /:id-only routes for clarity) -------------

missionsRouter.post(
  '/:id/amendments',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CreateAmendmentBodySchema }),
  asyncHandler(controller.createAmendment),
);

missionsRouter.get(
  '/:id/amendments',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listAmendments),
);

// --- Status + archive ------------------------------------------------------

missionsRouter.patch(
  '/:id/status',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: MissionStatusTransitionBodySchema }),
  asyncHandler(controller.changeStatus),
);

missionsRouter.patch(
  '/:id/archive',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.archiveMission),
);

// --- Detail + update -------------------------------------------------------

missionsRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'),
  requireOwnershipFor('CONSULTANT', (req) =>
    missionsService.resolveMissionOwnerForConsultant(
      req.params['id'] ?? '',
      req.user!.id,
    ),
  ),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getMission),
);

missionsRouter.patch(
  '/:id',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateMissionBodySchema }),
  asyncHandler(controller.updateMission),
);
