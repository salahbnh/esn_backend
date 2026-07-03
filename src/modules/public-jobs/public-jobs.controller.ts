import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './public-jobs.service.js';
import type { ApplyFile } from './public-jobs.service.js';
import type { PublicApplyBody } from './public-jobs.schema.js';

/**
 * HTTP layer for the PUBLIC portal. No auth, no actor. Reads multipart input,
 * calls the service, returns 202 on submit. Never leaks internal ids/state.
 */

function token(req: Request): string {
  const t = req.params['token'];
  if (t === undefined) throw AppError.badRequest('Missing token');
  return t;
}

export async function getPublicJob(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getPublicJob(token(req)));
}

export async function listSkills(_req: Request, res: Response): Promise<void> {
  const names = await service.listPublicSkillNames();
  res.status(200).json({ skills: names.map((name) => ({ name })) });
}

function firstFile(req: Request, field: string): ApplyFile | undefined {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const f = files?.[field]?.[0];
  if (!f) return undefined;
  return { buffer: f.buffer, originalname: f.originalname, size: f.size };
}

export async function apply(req: Request, res: Response): Promise<void> {
  const body = req.body as PublicApplyBody;
  const result = await service.apply(token(req), body, {
    cv: firstFile(req, 'cv'),
    coverLetter: firstFile(req, 'coverLetter'),
  });
  // 202 Accepted — enumeration-safe; the referenceId encodes nothing about
  // whether the applicant already exists (no Candidate lookup at apply time).
  res.status(202).json(result);
}
