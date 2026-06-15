import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './missions.service.js';
import type {
  CreateAmendmentBody,
  CreateMissionBody,
  ListMissionsQuery,
  MissionStatusTransitionBody,
  PaginationQuery,
  UpdateMissionBody,
} from './missions.schema.js';

/**
 * HTTP layer for the Missions module. Reads validated input, calls exactly one
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
// List + detail
// ---------------------------------------------------------------------------

export async function listMissions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListMissionsQuery;
  const result = await service.listMissions(query);
  res.status(200).json(result);
}

export async function getMission(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const mission = await service.getMission(param(req, 'id'), req.user.role);
  res.status(200).json(mission);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createMission(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateMissionBody;
  const mission = await service.createMission(body, actorId(req));
  res.status(201).json(mission);
}

export async function updateMission(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateMissionBody;
  const mission = await service.updateMission(param(req, 'id'), body, actorId(req));
  res.status(200).json(mission);
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const body = req.body as MissionStatusTransitionBody;
  const mission = await service.changeStatus(
    param(req, 'id'),
    body.status,
    body.comment,
    actorId(req),
  );
  res.status(200).json(mission);
}

export async function archiveMission(req: Request, res: Response): Promise<void> {
  const mission = await service.archiveMission(param(req, 'id'), actorId(req));
  res.status(200).json(mission);
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
