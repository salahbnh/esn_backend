import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { JobQuestion } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { buildStorageKey, putObject } from '../../lib/storage.js';
import * as repo from './public-jobs.repository.js';
import type { UploadedFileRecord } from './public-jobs.repository.js';
import { validateAnswers } from '../job-posts/questions.validator.js';
import type { ActiveQuestion } from '../job-posts/questions.validator.js';
import type { PublicApplyBody } from './public-jobs.schema.js';

/**
 * Public portal business logic. Isolated blast radius: imports ONLY repo,
 * storage, config, validator. MUST NOT import keycloak-admin or any authed
 * service. Never creates a Candidate (that is RH's link action). Enumeration-safe.
 */

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_MIME = new Set([PDF, DOCX]);

export interface ApplyFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

// --- Read: public job by token ---------------------------------------------

interface PublicQuestion {
  key: string;
  label: string;
  type: JobQuestion['type'];
  required: boolean;
  options?: string[];
  config?: Record<string, unknown>;
  helpText?: string;
}

/**
 * Load a job by public token and GATE it: 404 for not-found / DRAFT / archived
 * (no existence oracle); 410 for CLOSED or expired. Returns a minimal public
 * shape — no internal ids, author, or counts.
 */
async function loadPublishedJob(token: string) {
  const job = await repo.findJobByToken(token);
  if (!job || job.archivedAt || job.status === 'DRAFT') {
    throw AppError.notFound('Job not found');
  }
  if (job.status === 'CLOSED' || (job.expiresAt && job.expiresAt.getTime() < Date.now())) {
    throw new AppError(410, 'JOB_GONE', 'This job is no longer accepting applications');
  }
  return job;
}

export async function getPublicJob(token: string) {
  const job = await loadPublishedJob(token);
  const questions: PublicQuestion[] = job.questions.map((q) => ({
    key: q.key,
    label: q.label,
    type: q.type,
    required: q.required,
    ...(q.options ? { options: q.options as string[] } : {}),
    ...(q.config ? { config: q.config as Record<string, unknown> } : {}),
    ...(q.helpText ? { helpText: q.helpText } : {}),
  }));
  return {
    token: job.publicToken,
    title: job.title,
    description: job.description,
    ...(job.requirements ? { requirements: job.requirements } : {}),
    ...(job.location ? { location: job.location } : {}),
    employmentType: job.employmentType,
    ...(job.seniorityLevel ? { seniorityLevel: job.seniorityLevel } : {}),
    ...(job.minYearsExperience !== null ? { minYearsExperience: job.minYearsExperience } : {}),
    publishedAt: job.publishedAt?.toISOString() ?? null,
    ...(job.expiresAt ? { expiresAt: job.expiresAt.toISOString() } : {}),
    requiredSkills: job.requiredSkills.map((s) => s.name),
    questions,
  };
}

export function listPublicSkillNames(): Promise<string[]> {
  return repo.listSkillNames();
}

// --- CAPTCHA (config-gated) -------------------------------------------------

async function verifyCaptcha(token: string | undefined): Promise<void> {
  if (!config.TURNSTILE_SECRET) return; // disabled in dev
  if (!token) throw AppError.badRequest('Captcha required', { code: 'CAPTCHA_REQUIRED' });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.TURNSTILE_SECRET, response: token }),
  });
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) throw AppError.badRequest('Captcha verification failed', { code: 'CAPTCHA_FAILED' });
}

// --- File hardening ---------------------------------------------------------

async function uploadFile(
  file: ApplyFile,
  type: 'CV' | 'COVER_LETTER',
  folder: string,
): Promise<UploadedFileRecord> {
  // Magic-byte check — the client-declared mimetype is NOT trusted.
  const sniff = await fileTypeFromBuffer(file.buffer);
  if (!sniff || !ALLOWED_MIME.has(sniff.mime)) {
    throw AppError.badRequest('Only PDF or DOCX files are accepted', { code: 'INVALID_FILE_TYPE' });
  }
  const storageKey = buildStorageKey(config.PUBLIC_UPLOAD_PREFIX, folder, file.originalname);
  await putObject({ key: storageKey, body: file.buffer, contentType: sniff.mime });
  return {
    type,
    filename: file.originalname.slice(0, 200),
    mimeType: sniff.mime,
    sizeBytes: file.size,
    storageKey,
  };
}

// --- Apply ------------------------------------------------------------------

export interface ApplyResult {
  referenceId: string;
}

export async function apply(
  token: string,
  body: PublicApplyBody,
  files: { cv?: ApplyFile; coverLetter?: ApplyFile },
): Promise<ApplyResult> {
  // Honeypot: a filled hidden field means a bot. Return a fake success — never
  // reveal the trap and never write anything.
  if (body.hp_website && body.hp_website.trim().length > 0) {
    logger.warn({ token }, 'Public apply honeypot triggered');
    return { referenceId: randomUUID() };
  }

  await verifyCaptcha(body.cfTurnstileResponse);

  if (!body.consentAccepted) {
    throw AppError.badRequest('Consent is required', { code: 'CONSENT_REQUIRED' });
  }
  if (!files.cv) {
    throw AppError.badRequest('A CV file is required', { code: 'CV_REQUIRED' });
  }

  const job = await loadPublishedJob(token);

  // Dynamic answer validation against the job's LIVE questions.
  const activeQuestions: ActiveQuestion[] = job.questions.map((q) => ({
    key: q.key,
    label: q.label,
    type: q.type,
    required: q.required,
    ...(q.options ? { options: q.options as string[] } : {}),
    ...(q.config ? { config: q.config as ActiveQuestion['config'] } : {}),
  }));
  const answers = validateAnswers(activeQuestions, body.answers);

  // Declared skills: keep only names that exist in the catalogue (never create).
  const declaredSkills = (await repo.existingSkillNames(body.declaredSkillNames)).map((name) => ({ name }));

  // Storage I/O BEFORE the DB transaction. Isolated per-submission folder.
  const folder = randomUUID();
  const uploaded: UploadedFileRecord[] = [await uploadFile(files.cv, 'CV', folder)];
  if (files.coverLetter) {
    uploaded.push(await uploadFile(files.coverLetter, 'COVER_LETTER', folder));
  }

  const app = await repo.createApplication({
    jobPostId: job.id,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone ?? null,
    consentAcceptedAt: new Date(),
    jobTitleSnapshot: job.title,
    answers,
    declaredSkills,
    files: uploaded,
  });

  return { referenceId: app.id };
}
