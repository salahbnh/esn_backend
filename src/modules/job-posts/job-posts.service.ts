import { randomBytes } from 'node:crypto';
import type { QuestionType } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './job-posts.repository.js';
import type {
  CreateJobPostBody,
  CreateQuestionBody,
  LinkApplicationBody,
  ListApplicationsQuery,
  ListJobPostsQuery,
  PatchApplicationStatusBody,
  UpdateJobPostBody,
  UpdateQuestionBody,
} from './job-posts.schema.js';

/**
 * Job Posts business logic: post CRUD + state machine, the dynamic-question
 * builder, application triage, and the RH "link into ATS" action. Never imports
 * the Prisma client. Throws AppError on domain violations.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

function paginated<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

const CHOICE_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE'];

/** 128-bit URL-safe token — the public access key (not the cuid PK). */
function generatePublicToken(): string {
  return randomBytes(16).toString('base64url');
}

async function loadPostOr404(id: string) {
  const post = await repo.findJobPostById(id);
  if (!post || post.archivedAt) throw AppError.notFound('Job post not found');
  return post;
}

// --- Posts -----------------------------------------------------------------

export async function listJobPosts(query: ListJobPostsQuery) {
  const { items, total } = await repo.listJobPosts(
    {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function getJobPost(id: string) {
  const post = await repo.findJobPostDetail(id);
  if (!post || post.archivedAt) throw AppError.notFound('Job post not found');
  return post;
}

export async function createJobPost(body: CreateJobPostBody, actorId: string) {
  const post = await repo.createJobPost({
    title: body.title,
    description: body.description,
    employmentType: body.employmentType,
    publicToken: generatePublicToken(),
    authorId: actorId,
    ...(body.requirements !== undefined ? { requirements: body.requirements } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    ...(body.seniorityLevel !== undefined ? { seniorityLevel: body.seniorityLevel } : {}),
    ...(body.minYearsExperience !== undefined ? { minYearsExperience: body.minYearsExperience } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
    ...(body.skillIds !== undefined ? { skillIds: body.skillIds } : {}),
  });
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: post.id,
    action: 'CREATE',
    actorId,
    payload: { title: post.title },
  });
  return post;
}

export async function updateJobPost(id: string, body: UpdateJobPostBody, actorId: string) {
  const post = await loadPostOr404(id);
  if (post.status !== 'DRAFT') {
    throw new AppError(422, 'JOB_POST_NOT_DRAFT', 'Only DRAFT job posts can be edited');
  }
  const updated = await repo.updateJobPost(id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.requirements !== undefined ? { requirements: body.requirements } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    ...(body.employmentType !== undefined ? { employmentType: body.employmentType } : {}),
    ...(body.seniorityLevel !== undefined ? { seniorityLevel: body.seniorityLevel } : {}),
    ...(body.minYearsExperience !== undefined ? { minYearsExperience: body.minYearsExperience } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
    ...(body.skillIds !== undefined ? { skillIds: body.skillIds } : {}),
  });
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return updated;
}

export async function publishJobPost(id: string, actorId: string) {
  const post = await loadPostOr404(id);
  if (post.status !== 'DRAFT' && post.status !== 'CLOSED') {
    throw new AppError(422, 'JOB_POST_NOT_PUBLISHABLE', 'Only DRAFT or CLOSED posts can be published');
  }
  // Rotate the public token on publish/republish (invalidates any leaked link).
  const updated = await repo.publishJobPost(id, generatePublicToken(), new Date());
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: id,
    action: 'PUBLISH',
    actorId,
    payload: { from: post.status },
  });
  return updated;
}

export async function closeJobPost(id: string, actorId: string) {
  const post = await loadPostOr404(id);
  if (post.status !== 'PUBLISHED') {
    throw new AppError(422, 'JOB_POST_NOT_PUBLISHED', 'Only PUBLISHED posts can be closed');
  }
  const updated = await repo.setJobPostStatus(id, 'CLOSED');
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: id,
    action: 'CLOSE',
    actorId,
    payload: {},
  });
  return updated;
}

export async function archiveJobPost(id: string, actorId: string): Promise<void> {
  await loadPostOr404(id);
  const count = await repo.countApplications(id);
  if (count > 0) {
    throw AppError.conflict('Job post has applications and cannot be hard-deleted; archive retains them', {
      code: 'JOB_POST_HAS_APPLICATIONS',
      applications: count,
    });
  }
  await repo.archiveJobPost(id);
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: id,
    action: 'ARCHIVE',
    actorId,
    payload: {},
  });
}

// --- Questions -------------------------------------------------------------

function assertChoiceOptions(type: QuestionType, options?: string[]): void {
  if (CHOICE_TYPES.includes(type) && (!options || options.length < 2)) {
    throw AppError.badRequest('Choice questions require at least 2 options', {
      code: 'QUESTION_OPTIONS_REQUIRED',
    });
  }
}

export async function listQuestions(id: string) {
  await loadPostOr404(id);
  return repo.listQuestions(id);
}

export async function addQuestion(id: string, body: CreateQuestionBody, actorId: string) {
  await loadPostOr404(id);
  assertChoiceOptions(body.type, body.options);
  const order = await repo.nextQuestionOrder(id);
  const question = await repo.createQuestion({
    jobPostId: id,
    key: body.key,
    label: body.label,
    type: body.type,
    required: body.required,
    order,
    ...(body.options !== undefined ? { options: body.options } : {}),
    ...(body.config !== undefined ? { config: body.config } : {}),
    ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
  });
  await repo.writeAuditLog({
    entityType: 'JOB_POST',
    entityId: id,
    action: 'QUESTION_ADD',
    actorId,
    payload: { key: body.key },
  });
  return question;
}

export async function updateQuestion(id: string, qid: string, body: UpdateQuestionBody) {
  await loadPostOr404(id);
  const q = await repo.findQuestion(qid);
  if (!q || q.jobPostId !== id) throw AppError.notFound('Question not found');
  if (body.options !== undefined) assertChoiceOptions(q.type, body.options);
  return repo.updateQuestion(qid, {
    ...(body.label !== undefined ? { label: body.label } : {}),
    ...(body.required !== undefined ? { required: body.required } : {}),
    ...(body.options !== undefined ? { options: body.options } : {}),
    ...(body.config !== undefined ? { config: body.config } : {}),
    ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
  });
}

export async function archiveQuestion(id: string, qid: string): Promise<void> {
  await loadPostOr404(id);
  const q = await repo.findQuestion(qid);
  if (!q || q.jobPostId !== id) throw AppError.notFound('Question not found');
  await repo.archiveQuestion(qid);
}

export async function reorderQuestions(id: string, orderedIds: string[]): Promise<void> {
  await loadPostOr404(id);
  await repo.reorderQuestions(id, orderedIds);
}

// --- Applications ----------------------------------------------------------

export async function listApplications(id: string, query: ListApplicationsQuery) {
  await loadPostOr404(id);
  const { items, total } = await repo.listApplications(id, query.status, {
    page: query.page,
    pageSize: query.pageSize,
  });
  return paginated(items, total, query.page, query.pageSize);
}

export async function getApplication(appId: string) {
  const app = await repo.findApplicationDetail(appId);
  if (!app) throw AppError.notFound('Application not found');
  return app;
}

export async function patchApplicationStatus(
  appId: string,
  body: PatchApplicationStatusBody,
  actorId: string,
) {
  const app = await repo.findApplicationById(appId);
  if (!app) throw AppError.notFound('Application not found');
  return repo.patchApplicationStatus(appId, body.status, actorId, body.rejectionReason);
}

export async function linkApplication(appId: string, body: LinkApplicationBody, actorId: string) {
  const app = await repo.findApplicationById(appId);
  if (!app) throw AppError.notFound('Application not found');
  if (app.candidateId || app.status === 'LINKED') {
    throw AppError.conflict('Application is already linked', { code: 'ALREADY_LINKED' });
  }

  // Surface (never auto-act) when the email maps to an internal account or an
  // existing candidate who is already a consultant.
  const [userExists, candidate] = await Promise.all([
    repo.emailBelongsToUser(app.email),
    repo.findCandidateByEmail(app.email),
  ]);
  if (userExists || candidate?.consultant) {
    throw AppError.conflict('This email already belongs to a consultant/internal account — resolve manually', {
      code: 'CANDIDATE_IS_CONSULTANT',
    });
  }

  const skillNames = Array.isArray(app.declaredSkills)
    ? (app.declaredSkills as Array<{ name?: unknown }>)
        .map((s) => (typeof s?.name === 'string' ? s.name : null))
        .filter((n): n is string => n !== null)
    : [];

  return repo.linkApplication({
    applicationId: appId,
    email: app.email,
    firstName: app.firstName,
    lastName: app.lastName,
    phone: app.phone,
    jobPostId: app.jobPostId,
    skillNames,
    actorId,
    ...(body.targetPosition !== undefined ? { targetPosition: body.targetPosition } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  });
}
