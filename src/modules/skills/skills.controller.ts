import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './skills.service.js';
import type { CreateSkillBody, ListSkillsQuery, UpdateSkillBody } from './skills.schema.js';

/**
 * HTTP layer for the Skills module. Reads validated input, calls exactly one
 * service method, shapes the response. No business logic, no Prisma.
 */

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw AppError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

function actorId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export async function listSkills(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListSkillsQuery;
  const result = await service.listSkills(query);
  res.status(200).json(result);
}

export async function createSkill(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateSkillBody;
  const skill = await service.createSkill(body, actorId(req));
  res.status(201).json(skill);
}

export async function updateSkill(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateSkillBody;
  const skill = await service.updateSkill(param(req, 'id'), body, actorId(req));
  res.status(200).json(skill);
}

export async function removeSkill(req: Request, res: Response): Promise<void> {
  await service.removeSkill(param(req, 'id'), actorId(req));
  res.status(204).end();
}
