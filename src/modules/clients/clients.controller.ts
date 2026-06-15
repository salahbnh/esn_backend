import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './clients.service.js';
import type {
  CreateClientBody,
  ListClientsQuery,
  UpdateClientBody,
} from './clients.schema.js';

/**
 * HTTP layer for the Clients module. Reads validated input, calls exactly one
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

export async function listClients(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListClientsQuery;
  const result = await service.listClients(query);
  res.status(200).json(result);
}

export async function getClient(req: Request, res: Response): Promise<void> {
  const client = await service.getClient(param(req, 'id'));
  res.status(200).json(client);
}

export async function createClient(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateClientBody;
  const client = await service.createClient(body, actorId(req));
  res.status(201).json(client);
}

export async function updateClient(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateClientBody;
  const client = await service.updateClient(param(req, 'id'), body, actorId(req));
  res.status(200).json(client);
}
