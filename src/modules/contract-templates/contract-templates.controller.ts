import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './contract-templates.service.js';
import type {
  CreateTemplateBody,
  ListTemplatesQuery,
  UpdateTemplateBody,
} from './contract-templates.schema.js';

/**
 * HTTP layer for the Contract Templates sub-module. Reads validated input, calls
 * exactly one service method, shapes the response. No business logic, no Prisma.
 */

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw AppError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

function actorId(req: Request): string {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

export async function listTemplates(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListTemplatesQuery;
  const result = await service.listTemplates(query);
  res.status(200).json(result);
}

export async function getTemplate(req: Request, res: Response): Promise<void> {
  const template = await service.getTemplate(param(req, 'id'));
  res.status(200).json(template);
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTemplateBody;
  const template = await service.createTemplate(body, actorId(req));
  res.status(201).json(template);
}

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateTemplateBody;
  const template = await service.updateTemplate(param(req, 'id'), body, actorId(req));
  res.status(200).json(template);
}

export async function deactivateTemplate(req: Request, res: Response): Promise<void> {
  const template = await service.deactivateTemplate(param(req, 'id'), actorId(req));
  res.status(200).json(template);
}
