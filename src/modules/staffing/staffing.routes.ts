import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './staffing.controller.js';
import {
  AssignmentStatusTransitionBodySchema,
  ConsultantIdParamSchema,
  CreateAssignmentBodySchema,
  IdParamSchema,
  ListAssignmentsQuerySchema,
  OccupancyQuerySchema,
  SuggestionsQuerySchema,
  UpdateAssignmentBodySchema,
} from './staffing.schema.js';

/**
 * Staffing / Affectation routes — mounted at /api/staffing.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * POST   /assignments                 MANAGER, DIRECTION
 * GET    /assignments                 RH, MANAGER, DIRECTION
 * GET    /assignments/:id             RH, MANAGER, DIRECTION
 * PATCH  /assignments/:id             MANAGER, DIRECTION
 * PATCH  /assignments/:id/status      MANAGER, DIRECTION
 * GET    /occupancy/:consultantId     RH, MANAGER, DIRECTION (per-consultant)
 * GET    /occupancy                   MANAGER, DIRECTION     (global cross-consultant)
 * GET    /suggestions                 MANAGER, DIRECTION
 *
 * The consultant self-view (`GET /api/consultants/me/assignments`) lives on the
 * consultants router (plan §0a/D6), not here.
 */
export const staffingRouter = Router();

// Every route is authenticated.
staffingRouter.use(auth);

// --- Assignment list + create ----------------------------------------------

staffingRouter.post(
  '/assignments',
  rbac('MANAGER', 'DIRECTION'),
  validate({ body: CreateAssignmentBodySchema }),
  asyncHandler(controller.createAssignment),
);

staffingRouter.get(
  '/assignments',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListAssignmentsQuerySchema }),
  asyncHandler(controller.listAssignments),
);

// --- Status (declared before /:id-only for clarity) ------------------------

staffingRouter.patch(
  '/assignments/:id/status',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: AssignmentStatusTransitionBodySchema }),
  asyncHandler(controller.changeStatus),
);

// --- Detail + update -------------------------------------------------------

staffingRouter.get(
  '/assignments/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getAssignment),
);

staffingRouter.patch(
  '/assignments/:id',
  rbac('MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateAssignmentBodySchema }),
  asyncHandler(controller.updateAssignment),
);

// --- Occupancy + suggestions -----------------------------------------------

// Per-consultant occupancy — RH may read it (scoped to one consultant).
// Declared BEFORE the global `/occupancy` is irrelevant (distinct paths), but
// keep the more specific path first for clarity.
staffingRouter.get(
  '/occupancy/:consultantId',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: ConsultantIdParamSchema }),
  asyncHandler(controller.getConsultantOccupancy),
);

// Global cross-consultant occupancy — RH excluded at the route.
staffingRouter.get(
  '/occupancy',
  rbac('MANAGER', 'DIRECTION'),
  validate({ query: OccupancyQuerySchema }),
  asyncHandler(controller.listGlobalOccupancy),
);

staffingRouter.get(
  '/suggestions',
  rbac('MANAGER', 'DIRECTION'),
  validate({ query: SuggestionsQuerySchema }),
  asyncHandler(controller.getSuggestions),
);
