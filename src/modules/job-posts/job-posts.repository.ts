import type {
  Application,
  EntityType,
  JobPost,
  JobPostStatus,
  JobQuestion,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Job Posts data-access layer. The ONLY module file that imports the Prisma
 * client. Multi-write operations (reorder, link) run in a `$transaction` here.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface JobPostFilter {
  status?: JobPostStatus;
  search?: string;
}

export interface CreateJobPostData {
  title: string;
  description: string;
  requirements?: string;
  location?: string;
  employmentType: JobPost['employmentType'];
  seniorityLevel?: JobPost['seniorityLevel'];
  minYearsExperience?: number;
  expiresAt?: Date;
  publicToken: string;
  authorId: string;
  skillIds?: string[];
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

const DETAIL_INCLUDE = {
  requiredSkills: { select: { id: true, name: true, category: true } },
  questions: { where: { archivedAt: null }, orderBy: { order: 'asc' } },
  author: { select: { id: true, firstName: true, lastName: true } },
} as const;

// --- Job posts -------------------------------------------------------------

export function findJobPostById(id: string): Promise<JobPost | null> {
  return prisma.jobPost.findUnique({ where: { id } });
}

export function findJobPostDetail(id: string) {
  return prisma.jobPost.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

export async function listJobPosts(filter: JobPostFilter, pagination: Pagination) {
  const where: Prisma.JobPostWhereInput = { archivedAt: null };
  if (filter.status) where.status = filter.status;
  if (filter.search) where.title = { contains: filter.search, mode: 'insensitive' };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.jobPost.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        requiredSkills: { select: { id: true, name: true } },
        _count: { select: { applications: true } },
      },
    }),
    prisma.jobPost.count({ where }),
  ]);
  return { items, total };
}

export function createJobPost(data: CreateJobPostData) {
  const { skillIds, expiresAt, ...rest } = data;
  return prisma.jobPost.create({
    data: {
      ...rest,
      ...(expiresAt ? { expiresAt } : {}),
      ...(skillIds ? { requiredSkills: { connect: skillIds.map((id) => ({ id })) } } : {}),
    },
    include: DETAIL_INCLUDE,
  });
}

export function updateJobPost(id: string, data: Partial<CreateJobPostData> & { skillIds?: string[] }) {
  const { skillIds, ...rest } = data;
  return prisma.jobPost.update({
    where: { id },
    data: {
      ...rest,
      ...(skillIds ? { requiredSkills: { set: skillIds.map((sid) => ({ id: sid })) } } : {}),
    },
    include: DETAIL_INCLUDE,
  });
}

export function publishJobPost(id: string, publicToken: string, publishedAt: Date) {
  return prisma.jobPost.update({
    where: { id },
    data: { status: 'PUBLISHED', publicToken, publishedAt },
    include: DETAIL_INCLUDE,
  });
}

export function setJobPostStatus(id: string, status: JobPostStatus) {
  return prisma.jobPost.update({ where: { id }, data: { status }, include: DETAIL_INCLUDE });
}

export function archiveJobPost(id: string): Promise<JobPost> {
  return prisma.jobPost.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function countApplications(jobPostId: string): Promise<number> {
  return prisma.application.count({ where: { jobPostId } });
}

// --- Questions -------------------------------------------------------------

export function listQuestions(jobPostId: string): Promise<JobQuestion[]> {
  return prisma.jobQuestion.findMany({
    where: { jobPostId, archivedAt: null },
    orderBy: { order: 'asc' },
  });
}

export function findQuestion(qid: string): Promise<JobQuestion | null> {
  return prisma.jobQuestion.findUnique({ where: { id: qid } });
}

export async function nextQuestionOrder(jobPostId: string): Promise<number> {
  const last = await prisma.jobQuestion.findFirst({
    where: { jobPostId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (last?.order ?? -1) + 1;
}

export function createQuestion(data: Prisma.JobQuestionUncheckedCreateInput): Promise<JobQuestion> {
  return prisma.jobQuestion.create({ data });
}

export function updateQuestion(
  qid: string,
  data: Prisma.JobQuestionUncheckedUpdateInput,
): Promise<JobQuestion> {
  return prisma.jobQuestion.update({ where: { id: qid }, data });
}

export function archiveQuestion(qid: string): Promise<JobQuestion> {
  return prisma.jobQuestion.update({ where: { id: qid }, data: { archivedAt: new Date() } });
}

export function reorderQuestions(jobPostId: string, orderedIds: string[]): Promise<unknown> {
  return prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.jobQuestion.updateMany({ where: { id, jobPostId }, data: { order: index } }),
    ),
  );
}

// --- Applications ----------------------------------------------------------

export async function listApplications(
  jobPostId: string,
  status: Application['status'] | undefined,
  pagination: Pagination,
) {
  const where: Prisma.ApplicationWhereInput = { jobPostId };
  if (status) where.status = status;
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.application.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        candidateId: true,
        createdAt: true,
      },
    }),
    prisma.application.count({ where }),
  ]);
  return { items, total };
}

export function findApplicationById(id: string): Promise<Application | null> {
  return prisma.application.findUnique({ where: { id } });
}

/** Application detail + its (non-archived) document metadata — never storageKey. */
export async function findApplicationDetail(id: string) {
  const app = await prisma.application.findUnique({
    where: { id },
    include: { jobPost: { select: { id: true, title: true } } },
  });
  if (!app) return null;
  const documents = await prisma.document.findMany({
    where: { entityType: 'APPLICATION', entityId: id, archivedAt: null },
    select: { id: true, type: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
  return { ...app, documents };
}

export function patchApplicationStatus(
  id: string,
  status: Application['status'],
  reviewerId: string,
  rejectionReason?: string,
): Promise<Application> {
  return prisma.application.update({
    where: { id },
    data: {
      status,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      ...(rejectionReason !== undefined ? { rejectionReason } : {}),
    },
  });
}

/** Does an internal User account exist for this email (=> already a consultant/staff)? */
export async function emailBelongsToUser(email: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u !== null;
}

/** Candidate (with consultant flag) matching this email, if any. */
export function findCandidateByEmail(email: string) {
  return prisma.candidate.findUnique({
    where: { email },
    select: { id: true, consultant: { select: { id: true } } },
  });
}

export interface LinkApplicationInput {
  applicationId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  jobPostId: string;
  targetPosition?: string;
  notes?: string;
  skillNames: string[];
  actorId: string;
}

/**
 * Link an application into the ATS in one transaction: create-or-attach the
 * Candidate (dedupe by email), union declared skills (matched to the catalogue),
 * move the CV Document APPLICATION→CANDIDATE, set candidateId + status=LINKED.
 * Caller MUST have already rejected the email-belongs-to-consultant/user case.
 */
export function linkApplication(input: LinkApplicationInput): Promise<Application> {
  return prisma.$transaction(async (tx) => {
    const skills = input.skillNames.length
      ? await tx.skill.findMany({ where: { name: { in: input.skillNames } }, select: { id: true } })
      : [];
    const skillConnect = skills.map((s) => ({ id: s.id }));

    const existing = await tx.candidate.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    let candidateId: string;
    if (existing) {
      candidateId = existing.id;
      await tx.candidate.update({
        where: { id: existing.id },
        data: { skills: { connect: skillConnect } }, // union (connect is idempotent)
      });
      await tx.candidateInteraction.create({
        data: {
          candidateId: existing.id,
          type: 'NOTE',
          occurredAt: new Date(),
          summary: `Nouvelle candidature via le portail (offre ${input.jobPostId}).`,
          authorId: input.actorId,
        },
      });
    } else {
      const created = await tx.candidate.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          status: 'APPLIED',
          source: 'PORTAL',
          jobPostId: input.jobPostId,
          ...(input.targetPosition ? { targetPosition: input.targetPosition } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          ...(skillConnect.length ? { skills: { connect: skillConnect } } : {}),
        },
        select: { id: true },
      });
      candidateId = created.id;
    }

    // Move the CV document to the candidate so the existing candidate/convert
    // flow finds it. Cover letter stays on the application.
    await tx.document.updateMany({
      where: { entityType: 'APPLICATION', entityId: input.applicationId, type: 'CV', archivedAt: null },
      data: { entityType: 'CANDIDATE', entityId: candidateId },
    });

    const updated = await tx.application.update({
      where: { id: input.applicationId },
      data: {
        candidateId,
        status: 'LINKED',
        reviewedById: input.actorId,
        reviewedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: 'APPLICATION',
        entityId: input.applicationId,
        action: 'LINK',
        actorId: input.actorId,
        payload: { candidateId, attached: Boolean(existing) },
      },
    });

    return updated;
  });
}

export function writeAuditLog(entry: AuditLogData): Promise<unknown> {
  return prisma.auditLog.create({ data: entry });
}
