import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './recruitment.controller.js';
import {
  ConvertCandidateBodySchema,
  CreateCandidateBodySchema,
  CreateEvaluationBodySchema,
  CreateInteractionBodySchema,
  CreateProposalBodySchema,
  IdParamSchema,
  ListCandidatesQuerySchema,
  PaginationQuerySchema,
  ProposalParamsSchema,
  StatusTransitionBodySchema,
  UpdateCandidateBodySchema,
  UpdateProposalStatusBodySchema,
} from './recruitment.schema.js';

/**
 * Recruitment (ATS) routes — mounted at /api/candidates.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * POST   /                                   RH
 * GET    /                                   RH, MANAGER, DIRECTION
 * GET    /:id                                RH, MANAGER, DIRECTION
 * PATCH  /:id                                RH
 * PATCH  /:id/status                         RH
 * POST   /:id/interactions                   RH, MANAGER, DIRECTION
 * GET    /:id/interactions                   RH, MANAGER, DIRECTION
 * POST   /:id/evaluations                    RH, MANAGER, DIRECTION
 * GET    /:id/evaluations                    RH, MANAGER, DIRECTION
 * POST   /:id/proposals                      RH
 * PATCH  /:id/proposals/:proposalId/status   RH
 * GET    /:id/proposals                      RH, DIRECTION
 * POST   /:id/convert                        RH, DIRECTION
 */
export const recruitmentRouter = Router();

// Every route is authenticated.
recruitmentRouter.use(auth);

// --- Candidate CRUD --------------------------------------------------------

recruitmentRouter.post(
  '/',
  rbac('RH'),
  validate({ body: CreateCandidateBodySchema }),
  asyncHandler(controller.createCandidate),
);

recruitmentRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListCandidatesQuerySchema }),
  asyncHandler(controller.listCandidates),
);

recruitmentRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getCandidate),
);

recruitmentRouter.patch(
  '/:id',
  rbac('RH'),
  validate({ params: IdParamSchema, body: UpdateCandidateBodySchema }),
  asyncHandler(controller.updateCandidate),
);

// --- Pipeline status -------------------------------------------------------

recruitmentRouter.patch(
  '/:id/status',
  rbac('RH'),
  validate({ params: IdParamSchema, body: StatusTransitionBodySchema }),
  asyncHandler(controller.transitionStatus),
);

// --- Interactions ----------------------------------------------------------

recruitmentRouter.post(
  '/:id/interactions',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CreateInteractionBodySchema }),
  asyncHandler(controller.addInteraction),
);

recruitmentRouter.get(
  '/:id/interactions',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listInteractions),
);

// --- Evaluations -----------------------------------------------------------

recruitmentRouter.post(
  '/:id/evaluations',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CreateEvaluationBodySchema }),
  asyncHandler(controller.createEvaluation),
);

recruitmentRouter.get(
  '/:id/evaluations',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listEvaluations),
);

// --- Proposals -------------------------------------------------------------

recruitmentRouter.post(
  '/:id/proposals',
  rbac('RH'),
  validate({ params: IdParamSchema, body: CreateProposalBodySchema }),
  asyncHandler(controller.createProposal),
);

recruitmentRouter.patch(
  '/:id/proposals/:proposalId/status',
  rbac('RH'),
  validate({ params: ProposalParamsSchema, body: UpdateProposalStatusBodySchema }),
  asyncHandler(controller.updateProposalStatus),
);

recruitmentRouter.get(
  '/:id/proposals',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, query: PaginationQuerySchema }),
  asyncHandler(controller.listProposals),
);

// --- Conversion ------------------------------------------------------------

recruitmentRouter.post(
  '/:id/convert',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: ConvertCandidateBodySchema }),
  asyncHandler(controller.convertCandidate),
);
