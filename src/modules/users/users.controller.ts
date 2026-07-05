import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './users.service.js';
import type { CreateUserBody, ListUsersQuery, PatchUserStatusBody } from './users.schema.js';

/**
 * HTTP layer for the Users admin module. Reads validated input, calls one
 * service method, shapes the response. No business logic, no Prisma.
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

export async function listUsers(req: Request, res: Response): Promise<void> {
  const result = await service.listUsers(req.query as unknown as ListUsersQuery);
  res.status(200).json(result);
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const user = await service.createStaffUser(req.body as CreateUserBody, actorId(req));
  res.status(201).json(user);
}

export async function patchUserStatus(req: Request, res: Response): Promise<void> {
  const user = await service.patchUserStatus(
    param(req, 'id'),
    req.body as PatchUserStatusBody,
    actorId(req),
  );
  res.status(200).json(user);
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  await service.resendUserInvite(param(req, 'id'), actorId(req));
  res.status(204).end();
}
