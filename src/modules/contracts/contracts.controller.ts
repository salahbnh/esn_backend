import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './contracts.service.js';
import type {
  AttachSignedPdfBody,
  CreateAmendmentBody,
  CreateContractBody,
  ListContractsQuery,
  PaginationQuery,
  UpdateContractBody,
  ValidateStepBody,
} from './contracts.schema.js';

/**
 * HTTP layer for the Contracts module. Reads validated input, calls exactly one
 * service method, shapes the response. No business logic, no Prisma. The actor
 * is ALWAYS taken from the verified `req.user.id`.
 */

function actorId(req: Request): string {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw AppError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listContracts(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListContractsQuery;
  const result = await service.listContracts(query);
  res.status(200).json(result);
}

export async function getContract(req: Request, res: Response): Promise<void> {
  const contract = await service.getContract(param(req, 'id'));
  res.status(200).json(contract);
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createContract(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateContractBody;
  const contract = await service.createContract(body, actorId(req));
  res.status(201).json(contract);
}

export async function updateContract(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateContractBody;
  const contract = await service.updateContract(param(req, 'id'), body, actorId(req));
  res.status(200).json(contract);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function submitContract(req: Request, res: Response): Promise<void> {
  const contract = await service.submitForValidation(param(req, 'id'), actorId(req));
  res.status(200).json(contract);
}

export async function validateContract(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const body = req.body as ValidateStepBody;
  const contract = await service.processValidationStep(
    param(req, 'id'),
    body.decision,
    body.comment,
    req.user.role,
    req.user.id,
  );
  res.status(200).json(contract);
}

export async function signContract(req: Request, res: Response): Promise<void> {
  const body = req.body as AttachSignedPdfBody;
  const contract = await service.signContract(
    param(req, 'id'),
    body.signedPdfDocumentId,
    actorId(req),
  );
  res.status(200).json(contract);
}

export async function archiveContract(req: Request, res: Response): Promise<void> {
  const contract = await service.archiveContract(param(req, 'id'), actorId(req));
  res.status(200).json(contract);
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

export async function createAmendment(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateAmendmentBody;
  const amendment = await service.createAmendment(param(req, 'id'), body, actorId(req));
  res.status(201).json(amendment);
}

export async function listAmendments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PaginationQuery;
  const result = await service.listAmendments(param(req, 'id'), query);
  res.status(200).json(result);
}
