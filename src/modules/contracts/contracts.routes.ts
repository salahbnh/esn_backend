import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac, requireOwnershipFor } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './contracts.controller.js';
import * as contractsService from './contracts.service.js';
import {
  ConsultantSignBodySchema,
  CountersignBodySchema,
  CreateAmendmentBodySchema,
  CreateContractBodySchema,
  IdParamSchema,
  ListContractsQuerySchema,
  PaginationQuerySchema,
  RejectContractBodySchema,
  UpdateContractBodySchema,
  ValidateStepBodySchema,
} from './contracts.schema.js';

/**
 * Contracts routes — mounted at /api/contracts. Authorization is declared here
 * (server-side), never in the controller/UI.
 *
 * POST   /                     RH, DIRECTION
 * GET    /                     RH, MANAGER, DIRECTION
 * GET    /mine                 CONSULTANT (own contracts; auto-scoped by userId)
 * GET    /:id                  RH, MANAGER, DIRECTION; CONSULTANT (own only)
 * PATCH  /:id                  RH, DIRECTION (DRAFT only)
 * PATCH  /:id/submit           RH, DIRECTION
 * PATCH  /:id/validate         RH, MANAGER, DIRECTION (step→role gate in service)
 * POST   /:id/generate-pdf     RH, DIRECTION (in-app PDF; guarded ready + complete)
 * PATCH  /:id/consultant-sign  CONSULTANT (own only) — in-app signature stamp
 * PATCH  /:id/reject           CONSULTANT (own only) — reject with reason → DRAFT
 * PATCH  /:id/countersign      RH, DIRECTION — company countersign → SIGNED
 * PATCH  /:id/archive          RH, DIRECTION
 * POST   /:id/amendments       RH, DIRECTION
 * GET    /:id/amendments       RH, MANAGER, DIRECTION
 *
 * The CONSULTANT own-contract read/sign/reject is gated by
 * `requireOwnershipFor('CONSULTANT', resolver)`; the resolver calls the contracts
 * SERVICE (never the repository) to resolve the owning consultant's userId from
 * the DB — never from the request. `GET /mine` is declared BEFORE `/:id` so the
 * literal segment wins over the cuid param.
 */
export const contractsRouter = Router();

contractsRouter.use(auth);

// --- List + create ---------------------------------------------------------

contractsRouter.post(
  '/',
  rbac('RH', 'DIRECTION'),
  validate({ body: CreateContractBodySchema }),
  asyncHandler(controller.createContract),
);

contractsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListContractsQuerySchema }),
  asyncHandler(controller.listContracts),
);

// --- Consultant self-service — MUST precede `/:id` so "mine" is not a cuid param
contractsRouter.get(
  '/mine',
  rbac('CONSULTANT'),
  validate({ query: PaginationQuerySchema }),
  asyncHandler(controller.listMyContracts),
);

// --- Amendments (declared before /:id-only routes for clarity) -------------

contractsRouter.post(
  '/:id/amendments',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CreateAmendmentBodySchema }),
  asyncHandler(controller.createAmendment),
);

contractsRouter.get(
  '/:id/amendments',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listAmendments),
);

// --- Workflow transitions --------------------------------------------------

contractsRouter.patch(
  '/:id/submit',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.submitContract),
);

contractsRouter.patch(
  '/:id/validate',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: ValidateStepBodySchema }),
  asyncHandler(controller.validateContract),
);

contractsRouter.post(
  '/:id/generate-pdf',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.generateContractPdf),
);

// Consultant signs / rejects their OWN contract (ownership resolved from the DB).
// Ownership composed after validate — consistent with `GET /:id` in this file.
contractsRouter.patch(
  '/:id/consultant-sign',
  rbac('CONSULTANT'),
  validate({ params: IdParamSchema, body: ConsultantSignBodySchema }),
  requireOwnershipFor('CONSULTANT', (req) =>
    contractsService.resolveContractOwnerUserId(req.params['id'] ?? ''),
  ),
  asyncHandler(controller.consultantSignContract),
);

contractsRouter.patch(
  '/:id/reject',
  rbac('CONSULTANT'),
  validate({ params: IdParamSchema, body: RejectContractBodySchema }),
  requireOwnershipFor('CONSULTANT', (req) =>
    contractsService.resolveContractOwnerUserId(req.params['id'] ?? ''),
  ),
  asyncHandler(controller.rejectContract),
);

// Company countersign (RH/DIRECTION) → SIGNED.
contractsRouter.patch(
  '/:id/countersign',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CountersignBodySchema }),
  asyncHandler(controller.countersignContract),
);

contractsRouter.patch(
  '/:id/archive',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.archiveContract),
);

// --- Detail + update -------------------------------------------------------

contractsRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'),
  validate({ params: IdParamSchema }),
  requireOwnershipFor('CONSULTANT', (req) =>
    contractsService.resolveContractOwnerUserId(req.params['id'] ?? ''),
  ),
  asyncHandler(controller.getContract),
);

contractsRouter.patch(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateContractBodySchema }),
  asyncHandler(controller.updateContract),
);
