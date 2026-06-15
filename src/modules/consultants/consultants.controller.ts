import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './consultants.service.js';
import type {
  ListConsultantsQuery,
  PaginationQuery,
  StatusChangeBody,
  UpdateConsultantBody,
  UpdateOwnProfileBody,
} from './consultants.schema.js';

/**
 * HTTP layer for the Consultants module. Reads validated input, calls exactly
 * one service method, shapes the response. No business logic, no Prisma. The
 * actor is ALWAYS taken from the verified `req.user.id`; `/me` routes resolve
 * the consultant by `req.user.id` — never from the body or query.
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
// List + detail
// ---------------------------------------------------------------------------

export async function listConsultants(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListConsultantsQuery;
  const result = await service.listConsultants(query);
  res.status(200).json(result);
}

export async function getConsultant(req: Request, res: Response): Promise<void> {
  const consultant = await service.getConsultant(param(req, 'id'));
  res.status(200).json(consultant);
}

// ---------------------------------------------------------------------------
// Self-service (/me) — identity is req.user.id, never a param
// ---------------------------------------------------------------------------

export async function getOwnProfile(req: Request, res: Response): Promise<void> {
  const consultant = await service.getOwnProfile(actorId(req));
  res.status(200).json(consultant);
}

export async function updateOwnProfile(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateOwnProfileBody;
  const consultant = await service.updateOwnProfile(actorId(req), body);
  res.status(200).json(consultant);
}

// ---------------------------------------------------------------------------
// Admin update + status
// ---------------------------------------------------------------------------

export async function updateConsultant(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateConsultantBody;
  const consultant = await service.updateConsultant(param(req, 'id'), body, actorId(req));
  res.status(200).json(consultant);
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const body = req.body as StatusChangeBody;
  const consultant = await service.changeStatus(
    param(req, 'id'),
    body.status,
    body.comment,
    actorId(req),
  );
  res.status(200).json(consultant);
}

// ---------------------------------------------------------------------------
// Documents metadata
// ---------------------------------------------------------------------------

export async function listConsultantDocuments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PaginationQuery;
  const result = await service.listConsultantDocuments(param(req, 'id'), query);
  res.status(200).json(result);
}
