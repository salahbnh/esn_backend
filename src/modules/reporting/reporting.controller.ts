import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './reporting.service.js';
import type { ReportWindowQuery } from './reporting.schema.js';

/**
 * HTTP layer for the Reporting module. Reads validated input, calls exactly one
 * service method, shapes the response. No business logic, no Prisma. The actor
 * (and the role driving summary filtering / `/me` ownership) is ALWAYS taken
 * from the verified `req.user` — never from the body or query.
 */

function actorId(req: Request): string {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

export async function getOccupancy(_req: Request, res: Response): Promise<void> {
  const result = await service.getOccupancy();
  res.status(200).json(result);
}

export async function getPipeline(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ReportWindowQuery;
  const result = await service.getPipeline(query);
  res.status(200).json(result);
}

export async function getMissions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ReportWindowQuery;
  const result = await service.getMissions(query);
  res.status(200).json(result);
}

export async function getHr(_req: Request, res: Response): Promise<void> {
  const result = await service.getHr();
  res.status(200).json(result);
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const result = await service.getSummary(req.user.role);
  res.status(200).json(result);
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const result = await service.getMe(actorId(req));
  res.status(200).json(result);
}
