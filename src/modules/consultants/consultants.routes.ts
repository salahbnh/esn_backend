import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac, requireOwnershipFor } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './consultants.controller.js';
import * as service from './consultants.service.js';
import {
  IdParamSchema,
  ListConsultantsQuerySchema,
  PaginationQuerySchema,
  StatusChangeBodySchema,
  UpdateConsultantBodySchema,
  UpdateOwnProfileBodySchema,
} from './consultants.schema.js';
import { OwnAssignmentsQuerySchema } from '../staffing/staffing.schema.js';

/**
 * Consultants routes — mounted at /api/consultants.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * GET    /                  RH, MANAGER, DIRECTION
 * GET    /me                CONSULTANT
 * PATCH  /me                CONSULTANT
 * GET    /me/assignments    CONSULTANT (own assignments; delegates to staffing.service)
 * GET    /:id               RH, MANAGER, DIRECTION
 * PATCH  /:id               RH, DIRECTION
 * PATCH  /:id/status        RH, MANAGER, DIRECTION
 * GET    /:id/documents     RH, DIRECTION; CONSULTANT (own only)
 *
 * CRITICAL: the literal `/me` routes are declared BEFORE `/:id` so Express does
 * not match the string "me" as a CUID id param.
 */
export const consultantsRouter = Router();

// Every route is authenticated.
consultantsRouter.use(auth);

// --- List ------------------------------------------------------------------

consultantsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListConsultantsQuerySchema }),
  asyncHandler(controller.listConsultants),
);

// --- Self-service (/me) — MUST precede /:id --------------------------------

consultantsRouter.get(
  '/me',
  rbac('CONSULTANT'),
  asyncHandler(controller.getOwnProfile),
);

consultantsRouter.patch(
  '/me',
  rbac('CONSULTANT'),
  validate({ body: UpdateOwnProfileBodySchema }),
  asyncHandler(controller.updateOwnProfile),
);

// Consultant self-view of their own assignments (plan §0a/D6). Declared with the
// `/me` routes, BEFORE `/:id`, so "me" is never matched as a CUID id param.
consultantsRouter.get(
  '/me/assignments',
  rbac('CONSULTANT'),
  validate({ query: OwnAssignmentsQuerySchema }),
  asyncHandler(controller.listOwnAssignments),
);

// --- Detail + admin update -------------------------------------------------

consultantsRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getConsultant),
);

consultantsRouter.patch(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateConsultantBodySchema }),
  asyncHandler(controller.updateConsultant),
);

// --- Status ----------------------------------------------------------------

consultantsRouter.patch(
  '/:id/status',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: StatusChangeBodySchema }),
  asyncHandler(controller.changeStatus),
);

// --- Documents metadata (dual-role: Option A inline branch) ----------------
// RH/DIRECTION may read any consultant's documents; a CONSULTANT may read only
// their own (ownership resolved from the DB). MANAGER is excluded.

consultantsRouter.get(
  '/:id/documents',
  rbac('RH', 'DIRECTION', 'CONSULTANT'),
  requireOwnershipFor('CONSULTANT', (req) =>
    service.resolveConsultantOwnerId(req.params['id'] ?? ''),
  ),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listConsultantDocuments),
);
