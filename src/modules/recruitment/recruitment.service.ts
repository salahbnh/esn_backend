import type {
  Candidate,
  CandidateEvaluation,
  CandidateInteraction,
  CandidateStatus,
  Consultant,
  Proposal,
} from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import { activateUser, provisionUser, deleteUser } from '../../lib/keycloak-admin.js';
import { logger } from '../../lib/logger.js';
import * as repo from './recruitment.repository.js';
import type {
  ConvertCandidateBody,
  CreateCandidateBody,
  CreateEvaluationBody,
  CreateInteractionBody,
  CreateProposalBody,
  UpdateCandidateBody,
} from './recruitment.schema.js';

/**
 * Recruitment business logic: candidate lifecycle, the pipeline state machine,
 * interactions/evaluations/proposals, and candidate -> consultant conversion.
 * Throws AppError on domain violations. Never imports the Prisma client.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ConversionResult {
  candidate: Candidate;
  consultant: Consultant;
}

/** Candidate pipeline state machine. HIRED is reached only via conversion. */
const ALLOWED_TRANSITIONS: Record<CandidateStatus, CandidateStatus[]> = {
  APPLIED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['REJECTED'],
  REJECTED: [],
  HIRED: [],
};

/** Proposal status machine: DRAFT -> SENT -> ACCEPTED | DECLINED. */
const ALLOWED_PROPOSAL_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'DECLINED'],
  ACCEPTED: [],
  DECLINED: [],
};

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadCandidateOr404(id: string): Promise<Candidate> {
  const candidate = await repo.findCandidateById(id);
  if (!candidate) {
    throw AppError.notFound('Candidate not found');
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Candidate CRUD
// ---------------------------------------------------------------------------

export async function createCandidate(
  body: CreateCandidateBody,
  actorId: string,
): Promise<Candidate> {
  const existing = await repo.findCandidateByEmail(body.email);
  if (existing) {
    throw AppError.conflict('A candidate with this email already exists', { code: 'EMAIL_EXISTS' });
  }

  const candidate = await repo.createCandidate(body);
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: candidate.id,
    action: 'CREATE',
    actorId,
    payload: { email: candidate.email },
  });
  return candidate;
}

export async function getCandidate(id: string) {
  const candidate = await repo.findCandidateDetail(id);
  if (!candidate) {
    throw AppError.notFound('Candidate not found');
  }
  return candidate;
}

export async function updateCandidate(
  id: string,
  body: UpdateCandidateBody,
  actorId: string,
): Promise<Candidate> {
  await loadCandidateOr404(id);

  if (body.email) {
    const collision = await repo.findCandidateByEmail(body.email);
    if (collision && collision.id !== id) {
      throw AppError.conflict('Another candidate already uses this email', { code: 'EMAIL_EXISTS' });
    }
  }

  const candidate = await repo.updateCandidate(id, body);
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return candidate;
}

export async function listCandidates(query: {
  status?: CandidateStatus;
  search?: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<Candidate>> {
  const { items, total } = await repo.listCandidates(
    { status: query.status, search: query.search },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

// ---------------------------------------------------------------------------
// Pipeline status transition
// ---------------------------------------------------------------------------

export async function transitionStatus(
  candidateId: string,
  toStatus: CandidateStatus,
  comment: string | undefined,
  actorId: string,
): Promise<Candidate> {
  const candidate = await loadCandidateOr404(candidateId);

  if (toStatus === 'HIRED') {
    throw AppError.badRequest(
      'Use the convert endpoint to hire a candidate',
      { code: 'INVALID_TRANSITION' },
    );
  }

  const allowed = ALLOWED_TRANSITIONS[candidate.status];
  if (!allowed.includes(toStatus)) {
    throw AppError.badRequest(
      `Cannot transition candidate from ${candidate.status} to ${toStatus}`,
      { code: 'INVALID_TRANSITION', from: candidate.status, to: toStatus },
    );
  }

  const updated = await repo.updateCandidateStatus(candidateId, toStatus);
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: candidateId,
    action: 'STATUS_CHANGE',
    actorId,
    payload: { from: candidate.status, to: toStatus, comment: comment ?? null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function addInteraction(
  candidateId: string,
  body: CreateInteractionBody,
  authorId: string,
): Promise<CandidateInteraction> {
  await loadCandidateOr404(candidateId);
  const interaction = await repo.createInteraction({
    candidateId,
    type: body.type,
    occurredAt: new Date(body.occurredAt),
    summary: body.summary,
    authorId,
  });
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: candidateId,
    action: 'CREATE',
    actorId: authorId,
    payload: { interactionId: interaction.id, type: interaction.type },
  });
  return interaction;
}

export async function listInteractions(
  candidateId: string,
  pagination: { page: number; pageSize: number },
): Promise<PaginatedResult<CandidateInteraction>> {
  await loadCandidateOr404(candidateId);
  const { items, total } = await repo.listInteractions(candidateId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export async function createEvaluation(
  candidateId: string,
  body: CreateEvaluationBody,
  evaluatorId: string,
): Promise<CandidateEvaluation> {
  await loadCandidateOr404(candidateId);
  return repo.createEvaluation({
    candidateId,
    evaluatorId,
    criteria: body.criteria,
    overallScore: body.overallScore,
    ...(body.recommendation !== undefined ? { recommendation: body.recommendation } : {}),
    ...(body.comment !== undefined ? { comment: body.comment } : {}),
  });
}

export async function listEvaluations(
  candidateId: string,
  pagination: { page: number; pageSize: number },
): Promise<PaginatedResult<CandidateEvaluation>> {
  await loadCandidateOr404(candidateId);
  const { items, total } = await repo.listEvaluations(candidateId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export async function createProposal(
  candidateId: string,
  body: CreateProposalBody,
  actorId: string,
): Promise<Proposal> {
  await loadCandidateOr404(candidateId);
  // TODO: Documents module — trigger proposal PDF generation, set documentId.
  const proposal = await repo.createProposal({ candidateId, content: body.content });
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: candidateId,
    action: 'CREATE',
    actorId,
    payload: { proposalId: proposal.id, status: proposal.status },
  });
  return proposal;
}

export async function updateProposalStatus(
  candidateId: string,
  proposalId: string,
  toStatus: string,
  actorId: string,
): Promise<Proposal> {
  await loadCandidateOr404(candidateId);

  const proposal = await repo.findProposalById(proposalId);
  if (!proposal || proposal.candidateId !== candidateId) {
    throw AppError.notFound('Proposal not found');
  }

  const allowed = ALLOWED_PROPOSAL_TRANSITIONS[proposal.status] ?? [];
  if (!allowed.includes(toStatus)) {
    throw AppError.badRequest(
      `Cannot transition proposal from ${proposal.status} to ${toStatus}`,
      { code: 'INVALID_TRANSITION', from: proposal.status, to: toStatus },
    );
  }

  const updated = await repo.updateProposalStatus(proposalId, toStatus);
  await repo.writeAuditLog({
    entityType: 'CANDIDATE',
    entityId: candidateId,
    action: 'STATUS_CHANGE',
    actorId,
    payload: { proposalId, from: proposal.status, to: toStatus },
  });
  return updated;
}

export async function listProposals(
  candidateId: string,
  pagination: { page: number; pageSize: number },
): Promise<PaginatedResult<Proposal>> {
  await loadCandidateOr404(candidateId);
  const { items, total } = await repo.listProposals(candidateId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}

// ---------------------------------------------------------------------------
// Conversion (auto-provision Keycloak + atomic DB write + compensation)
// ---------------------------------------------------------------------------

export async function convertToConsultant(
  candidateId: string,
  body: ConvertCandidateBody,
  actorId: string,
): Promise<ConversionResult> {
  const candidate = await loadCandidateOr404(candidateId);

  if (candidate.status !== 'VALIDATED') {
    throw AppError.badRequest('Candidate must be VALIDATED before conversion', {
      code: 'INVALID_STATUS',
      status: candidate.status,
    });
  }

  const existingConsultant = await repo.findConsultantByCandidateId(candidateId);
  if (existingConsultant) {
    throw AppError.conflict('This candidate has already been converted to a consultant', {
      code: 'USER_ALREADY_CONSULTANT',
    });
  }

  const existingUser = await repo.findUserByEmail(candidate.email);
  if (existingUser) {
    throw AppError.conflict('A user account already exists for this email', {
      code: 'USER_ALREADY_EXISTS',
    });
  }

  // 1. Provision the Keycloak account first (we need its `sub` for User.keycloakId).
  //    The account is created DISABLED and only enabled after the DB tx commits.
  const { id: keycloakId } = await provisionUser({
    email: candidate.email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    realmRole: 'CONSULTANT',
  });

  // 2. Atomic DB write. On failure, compensate by deleting the Keycloak account.
  let result: ConversionResult;
  try {
    result = await repo.createConsultantFromCandidate({
      email: candidate.email,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      keycloakId,
      candidateId,
      actorId,
      position: body.position,
      ...(body.hireDate ? { hireDate: new Date(body.hireDate) } : {}),
      ...(body.tjm !== undefined ? { tjm: body.tjm } : {}),
      ...(body.seniority !== undefined ? { seniority: body.seniority } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.skillIds ? { skillIds: body.skillIds } : {}),
    });
  } catch (e) {
    await deleteUser(keycloakId).catch(() => undefined);
    throw e;
  }

  // 3. DB committed — enable the account so the consultant can log in. If this
  //    fails the consultant record still exists; surface the issue for manual
  //    enablement rather than rolling back a now-persisted conversion.
  try {
    await activateUser(keycloakId);
  } catch (e) {
    logger.error(
      { err: e, keycloakId, consultantId: result.consultant.id },
      'Consultant created but Keycloak account activation failed; enable manually',
    );
  }

  return result;
}
