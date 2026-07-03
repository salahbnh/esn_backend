import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Public portal data access — the ONLY module file importing Prisma. Reads a
 * published job by token; writes an Application (+ Document rows) in a
 * transaction. NO auth references, NO keycloak imports. Isolated blast radius.
 */

export function findJobByToken(token: string) {
  return prisma.jobPost.findUnique({
    where: { publicToken: token },
    include: {
      requiredSkills: { select: { name: true } },
      questions: { where: { archivedAt: null }, orderBy: { order: 'asc' } },
    },
  });
}

export async function listSkillNames(): Promise<string[]> {
  const skills = await prisma.skill.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  return skills.map((s) => s.name);
}

/** Of the given names, which exist in the catalogue (validate declared skills). */
export async function existingSkillNames(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const rows = await prisma.skill.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

export interface UploadedFileRecord {
  type: 'CV' | 'COVER_LETTER';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export interface CreateApplicationInput {
  jobPostId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  consentAcceptedAt: Date;
  jobTitleSnapshot: string;
  answers: unknown;
  declaredSkills: unknown;
  files: UploadedFileRecord[];
}

/** Create the Application + its Document rows (scanStatus PENDING) in one tx. */
export function createApplication(input: CreateApplicationInput): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.create({
      data: {
        jobPostId: input.jobPostId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        consentAcceptedAt: input.consentAcceptedAt,
        jobTitleSnapshot: input.jobTitleSnapshot,
        answers: input.answers as Prisma.InputJsonValue,
        declaredSkills: input.declaredSkills as Prisma.InputJsonValue,
        status: 'SUBMITTED',
      },
      select: { id: true },
    });

    for (const f of input.files) {
      await tx.document.create({
        data: {
          type: f.type,
          entityType: 'APPLICATION',
          entityId: app.id,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          storageKey: f.storageKey,
          uploadedById: null, // anonymous public upload
          scanStatus: 'PENDING', // AV quarantine stub
        },
      });
    }

    await tx.auditLog.create({
      data: {
        entityType: 'APPLICATION',
        entityId: app.id,
        action: 'PUBLIC_APPLICATION_RECEIVED',
        actorId: null,
        payload: { jobPostId: input.jobPostId },
      },
    });

    return app;
  });
}
