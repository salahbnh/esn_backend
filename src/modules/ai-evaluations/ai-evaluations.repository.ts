import type { AiVerdict, EntityType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Data access for AI evaluations. The ONLY layer of this module touching Prisma.
 */

const createdByInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export interface CreateEvaluationData {
  applicationId: string;
  score: number;
  verdict: AiVerdict;
  strengths: string[];
  gaps: string[];
  reasoning: string;
  cvUsed: boolean;
  model: string;
  promptVersion: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  createdById: string;
}

export function createEvaluation(data: CreateEvaluationData) {
  return prisma.aiEvaluation.create({ data, include: createdByInclude });
}

export function listEvaluations(applicationId: string) {
  return prisma.aiEvaluation.findMany({
    where: { applicationId },
    orderBy: { createdAt: 'desc' },
    include: createdByInclude,
  });
}

/** Application + full job-post context needed to build the evaluation prompt. */
export function findApplicationForEval(id: string) {
  return prisma.application.findUnique({
    where: { id },
    include: {
      jobPost: { include: { requiredSkills: { select: { name: true } } } },
    },
  });
}

/**
 * Latest non-archived CV attached to the application. storageKey stays
 * server-side — used only to fetch bytes, never returned to the client.
 */
export function findCvDocument(applicationId: string) {
  return prisma.document.findFirst({
    where: {
      entityType: 'APPLICATION',
      entityId: applicationId,
      type: 'CV',
      archivedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, mimeType: true, sizeBytes: true, storageKey: true },
  });
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

export function writeAuditLog(entry: AuditLogData): Promise<unknown> {
  return prisma.auditLog.create({ data: entry });
}
