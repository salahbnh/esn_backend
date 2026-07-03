import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import * as service from './job-posts.service.js';
import type {
  CreateJobPostBody,
  CreateQuestionBody,
  LinkApplicationBody,
  ListApplicationsQuery,
  ListJobPostsQuery,
  PatchApplicationStatusBody,
  ReorderQuestionsBody,
  UpdateJobPostBody,
  UpdateQuestionBody,
} from './job-posts.schema.js';

/**
 * HTTP layer for the Job Posts admin module. Reads validated input, calls one
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

export async function listJobPosts(req: Request, res: Response): Promise<void> {
  const result = await service.listJobPosts(req.query as unknown as ListJobPostsQuery);
  res.status(200).json(result);
}

export async function getJobPost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getJobPost(param(req, 'id')));
}

export async function createJobPost(req: Request, res: Response): Promise<void> {
  const post = await service.createJobPost(req.body as CreateJobPostBody, actorId(req));
  res.status(201).json(post);
}

export async function updateJobPost(req: Request, res: Response): Promise<void> {
  const post = await service.updateJobPost(param(req, 'id'), req.body as UpdateJobPostBody, actorId(req));
  res.status(200).json(post);
}

export async function publishJobPost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.publishJobPost(param(req, 'id'), actorId(req)));
}

export async function closeJobPost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.closeJobPost(param(req, 'id'), actorId(req)));
}

export async function archiveJobPost(req: Request, res: Response): Promise<void> {
  await service.archiveJobPost(param(req, 'id'), actorId(req));
  res.status(204).end();
}

export async function listQuestions(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listQuestions(param(req, 'id')));
}

export async function addQuestion(req: Request, res: Response): Promise<void> {
  const q = await service.addQuestion(param(req, 'id'), req.body as CreateQuestionBody, actorId(req));
  res.status(201).json(q);
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  const q = await service.updateQuestion(param(req, 'id'), param(req, 'qid'), req.body as UpdateQuestionBody);
  res.status(200).json(q);
}

export async function archiveQuestion(req: Request, res: Response): Promise<void> {
  await service.archiveQuestion(param(req, 'id'), param(req, 'qid'));
  res.status(204).end();
}

export async function reorderQuestions(req: Request, res: Response): Promise<void> {
  const body = req.body as ReorderQuestionsBody;
  await service.reorderQuestions(param(req, 'id'), body.orderedIds);
  res.status(204).end();
}

export async function listApplications(req: Request, res: Response): Promise<void> {
  const result = await service.listApplications(
    param(req, 'id'),
    req.query as unknown as ListApplicationsQuery,
  );
  res.status(200).json(result);
}

export async function getApplication(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getApplication(param(req, 'id')));
}

export async function patchApplicationStatus(req: Request, res: Response): Promise<void> {
  const app = await service.patchApplicationStatus(
    param(req, 'id'),
    req.body as PatchApplicationStatusBody,
    actorId(req),
  );
  res.status(200).json(app);
}

export async function linkApplication(req: Request, res: Response): Promise<void> {
  const app = await service.linkApplication(param(req, 'id'), req.body as LinkApplicationBody, actorId(req));
  res.status(200).json(app);
}
