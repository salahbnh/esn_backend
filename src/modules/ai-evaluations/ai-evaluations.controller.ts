import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './ai-evaluations.service.js';

/**
 * HTTP layer for AI evaluations. Reads validated input, calls one service
 * method, shapes the response. No business logic, no Prisma.
 */

function actorId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) throw AppError.badRequest(`Missing route parameter: ${name}`);
  return value;
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  res.status(200).json(service.getStatus());
}

export async function triggerEvaluation(req: Request, res: Response): Promise<void> {
  const evaluation = await service.triggerEvaluation(param(req, 'id'), actorId(req));
  res.status(201).json(evaluation);
}

export async function listEvaluations(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listEvaluations(param(req, 'id')));
}
