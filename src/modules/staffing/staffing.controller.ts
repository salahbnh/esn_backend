import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './staffing.service.js';
import type {
  AssignmentStatusTransitionBody,
  CreateAssignmentBody,
  ListAssignmentsQuery,
  OccupancyQuery,
  SuggestionsQuery,
  UpdateAssignmentBody,
} from './staffing.schema.js';

/**
 * HTTP layer for the Staffing module. Reads validated input, calls exactly one
 * service method, shapes the response. No business logic, no Prisma. The actor
 * is ALWAYS taken from the verified `req.user.id` — never from the body or
 * query. (The consultant self-view lives on the consultants router at
 * `GET /api/consultants/me/assignments`.)
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
// Assignment CRUD
// ---------------------------------------------------------------------------

export async function createAssignment(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateAssignmentBody;
  const assignment = await service.createAssignment(body, actorId(req));
  res.status(201).json(assignment);
}

export async function listAssignments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListAssignmentsQuery;
  const result = await service.listAssignments(query);
  res.status(200).json(result);
}

export async function getAssignment(req: Request, res: Response): Promise<void> {
  const assignment = await service.getAssignment(param(req, 'id'));
  res.status(200).json(assignment);
}

export async function updateAssignment(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateAssignmentBody;
  const assignment = await service.updateAssignment(param(req, 'id'), body, actorId(req));
  res.status(200).json(assignment);
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const body = req.body as AssignmentStatusTransitionBody;
  const assignment = await service.changeAssignmentStatus(
    param(req, 'id'),
    body.status,
    body.comment,
    body.force ?? false,
    actorId(req),
  );
  res.status(200).json(assignment);
}

// ---------------------------------------------------------------------------
// Occupancy + suggestions
// ---------------------------------------------------------------------------

// Per-consultant occupancy (RH/MANAGER/DIRECTION) — gated at the route.
export async function getConsultantOccupancy(req: Request, res: Response): Promise<void> {
  const result = await service.getConsultantOccupancy(param(req, 'consultantId'));
  res.status(200).json(result);
}

// Global cross-consultant occupancy (MANAGER/DIRECTION; RH excluded at the route).
export async function listGlobalOccupancy(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as OccupancyQuery;
  const result = await service.listGlobalOccupancy({
    page: query.page,
    pageSize: query.pageSize,
  });
  res.status(200).json(result);
}

export async function getSuggestions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as SuggestionsQuery;
  const result = await service.suggestConsultantsForMission(query);
  res.status(200).json(result);
}
