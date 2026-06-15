import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './recruitment.service.js';
import type {
  ConvertCandidateBody,
  CreateCandidateBody,
  CreateEvaluationBody,
  CreateInteractionBody,
  CreateProposalBody,
  ListCandidatesQuery,
  PaginationQuery,
  StatusTransitionBody,
  UpdateCandidateBody,
  UpdateProposalStatusBody,
} from './recruitment.schema.js';

/**
 * HTTP layer for the Recruitment module. Reads validated input, calls exactly
 * one service method, shapes the response. No business logic, no Prisma.
 * The actor/author/evaluator is ALWAYS taken from the verified `req.user.id`.
 */

function actorId(req: Request): string {
  // `auth` middleware guarantees req.user; defensive guard keeps types honest.
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

/**
 * Read a route param that the `validate(params)` middleware has guaranteed is
 * present. Express types params as possibly-undefined under
 * noUncheckedIndexedAccess; the schema makes them required.
 */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw AppError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Candidate CRUD
// ---------------------------------------------------------------------------

export async function createCandidate(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateCandidateBody;
  const candidate = await service.createCandidate(body, actorId(req));
  res.status(201).json(candidate);
}

export async function listCandidates(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCandidatesQuery;
  const result = await service.listCandidates(query);
  res.status(200).json(result);
}

export async function getCandidate(req: Request, res: Response): Promise<void> {
  const candidate = await service.getCandidate(param(req, 'id'));
  res.status(200).json(candidate);
}

export async function updateCandidate(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateCandidateBody;
  const candidate = await service.updateCandidate(param(req, 'id'), body, actorId(req));
  res.status(200).json(candidate);
}

// ---------------------------------------------------------------------------
// Pipeline status transition
// ---------------------------------------------------------------------------

export async function transitionStatus(req: Request, res: Response): Promise<void> {
  const body = req.body as StatusTransitionBody;
  const candidate = await service.transitionStatus(
    param(req, 'id'),
    body.status,
    body.comment,
    actorId(req),
  );
  res.status(200).json(candidate);
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function addInteraction(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateInteractionBody;
  const interaction = await service.addInteraction(param(req, 'id'), body, actorId(req));
  res.status(201).json(interaction);
}

export async function listInteractions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PaginationQuery;
  const result = await service.listInteractions(param(req, 'id'), query);
  res.status(200).json(result);
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export async function createEvaluation(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateEvaluationBody;
  const evaluation = await service.createEvaluation(param(req, 'id'), body, actorId(req));
  res.status(201).json(evaluation);
}

export async function listEvaluations(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PaginationQuery;
  const result = await service.listEvaluations(param(req, 'id'), query);
  res.status(200).json(result);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export async function createProposal(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateProposalBody;
  const proposal = await service.createProposal(param(req, 'id'), body, actorId(req));
  res.status(201).json(proposal);
}

export async function updateProposalStatus(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateProposalStatusBody;
  const proposal = await service.updateProposalStatus(
    param(req, 'id'),
    param(req, 'proposalId'),
    body.status,
    actorId(req),
  );
  res.status(200).json(proposal);
}

export async function listProposals(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PaginationQuery;
  const result = await service.listProposals(param(req, 'id'), query);
  res.status(200).json(result);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export async function convertCandidate(req: Request, res: Response): Promise<void> {
  const body = req.body as ConvertCandidateBody;
  const result = await service.convertToConsultant(param(req, 'id'), body, actorId(req));
  res.status(201).json(result);
}
