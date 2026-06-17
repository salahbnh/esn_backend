import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './documents.service.js';
import type { AccessUser } from './documents.access.js';
import type { ListDocumentsQuery, UploadMeta } from './documents.schema.js';

/**
 * HTTP layer for the Documents module. Reads validated input + the multer file,
 * calls exactly one service method, shapes the response. No business logic, no
 * Prisma. The actor is ALWAYS taken from the verified `req.user`.
 */

function actor(req: Request): AccessUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return { id: req.user.id, role: req.user.role };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw AppError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const meta = req.body as UploadMeta;
  const doc = await service.uploadDocument(actor(req), meta, req.file);
  res.status(201).json(doc);
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListDocumentsQuery;
  const result = await service.listDocuments(actor(req), query);
  res.status(200).json(result);
}

export async function getDocumentUrl(req: Request, res: Response): Promise<void> {
  const result = await service.getDocumentUrl(actor(req), param(req, 'id'));
  res.status(200).json(result);
}

export async function deleteDocument(req: Request, res: Response): Promise<void> {
  await service.softDelete(actor(req), param(req, 'id'));
  res.status(204).send();
}

export async function restoreDocument(req: Request, res: Response): Promise<void> {
  await service.restore(actor(req), param(req, 'id'));
  res.status(200).json({ restored: true });
}
