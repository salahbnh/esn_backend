import type {
  Candidate,
  CandidateEvaluation,
  CandidateInteraction,
  CandidateStatus,
  Consultant,
  EntityType,
  Prisma,
  Proposal,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/app-error.js';

/**
 * Recruitment data-access layer. The ONLY module file that imports the Prisma
 * client. No business logic here — pure, deliberate data access.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface CandidateFilter {
  status?: CandidateStatus;
  search?: string;
}

export interface CreateCandidateData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  source?: string;
  targetPosition?: string;
  notes?: string;
  skillIds?: string[];
}

export interface UpdateCandidateData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: string;
  targetPosition?: string;
  notes?: string;
  skillIds?: string[];
}

export interface CreateInteractionData {
  candidateId: string;
  type: string;
  occurredAt: Date;
  summary: string;
  authorId: string;
}

export interface CreateEvaluationData {
  candidateId: string;
  evaluatorId: string;
  criteria: Record<string, number>;
  overallScore: number;
  recommendation?: string;
  comment?: string;
}

export interface CreateProposalData {
  candidateId: string;
  content: Record<string, unknown>;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

export interface ConsultantConversionData {
  email: string;
  firstName: string;
  lastName: string;
  keycloakId: string;
  candidateId: string;
  actorId: string;
  position: string;
  hireDate?: Date;
  tjm?: string;
  seniority?: string;
  bio?: string;
  skillIds?: string[];
}

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

export function findCandidateById(id: string): Promise<Candidate | null> {
  return prisma.candidate.findUnique({ where: { id } });
}

export function findCandidateDetail(id: string) {
  return prisma.candidate.findUnique({
    where: { id },
    include: {
      skills: true,
      interactions: { orderBy: { occurredAt: 'desc' } },
      evaluations: { orderBy: { createdAt: 'desc' } },
      proposals: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export function findCandidateByEmail(email: string): Promise<{ id: string } | null> {
  return prisma.candidate.findUnique({ where: { email }, select: { id: true } });
}

export function findUserByEmail(email: string): Promise<{ id: string } | null> {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

export function findConsultantByCandidateId(
  candidateId: string,
): Promise<{ id: string } | null> {
  return prisma.consultant.findUnique({ where: { candidateId }, select: { id: true } });
}

export function createCandidate(data: CreateCandidateData): Promise<Candidate> {
  const { skillIds, ...rest } = data;
  return prisma.candidate.create({
    data: {
      ...rest,
      ...(skillIds ? { skills: { connect: skillIds.map((id) => ({ id })) } } : {}),
    },
  });
}

export function updateCandidate(id: string, data: UpdateCandidateData): Promise<Candidate> {
  const { skillIds, ...rest } = data;
  return prisma.candidate.update({
    where: { id },
    data: {
      ...rest,
      ...(skillIds ? { skills: { set: skillIds.map((sid) => ({ id: sid })) } } : {}),
    },
  });
}

export function updateCandidateStatus(id: string, status: CandidateStatus): Promise<Candidate> {
  return prisma.candidate.update({ where: { id }, data: { status } });
}

export async function listCandidates(
  filter: CandidateFilter,
  pagination: Pagination,
): Promise<{ items: Candidate[]; total: number }> {
  const where: Prisma.CandidateWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  if (filter.search) {
    where.OR = [
      { firstName: { contains: filter.search, mode: 'insensitive' } },
      { lastName: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
    ];
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.candidate.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.candidate.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export function createInteraction(data: CreateInteractionData): Promise<CandidateInteraction> {
  return prisma.candidateInteraction.create({ data });
}

export async function listInteractions(
  candidateId: string,
  pagination: Pagination,
): Promise<{ items: CandidateInteraction[]; total: number }> {
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.candidateInteraction.findMany({
      where: { candidateId },
      skip,
      take,
      orderBy: { occurredAt: 'desc' },
    }),
    prisma.candidateInteraction.count({ where: { candidateId } }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export function createEvaluation(data: CreateEvaluationData): Promise<CandidateEvaluation> {
  return prisma.candidateEvaluation.create({
    data: { ...data, criteria: data.criteria as Prisma.InputJsonValue },
  });
}

export async function listEvaluations(
  candidateId: string,
  pagination: Pagination,
): Promise<{ items: CandidateEvaluation[]; total: number }> {
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.candidateEvaluation.findMany({
      where: { candidateId },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.candidateEvaluation.count({ where: { candidateId } }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function createProposal(data: CreateProposalData): Promise<Proposal> {
  // documentId stays null — PDF generation is deferred.
  // TODO: Documents module — generate the proposal PDF and set documentId.
  return prisma.proposal.create({
    data: {
      candidateId: data.candidateId,
      status: 'DRAFT',
      content: data.content as Prisma.InputJsonValue,
    },
  });
}

export function findProposalById(id: string): Promise<Proposal | null> {
  return prisma.proposal.findUnique({ where: { id } });
}

export function updateProposalStatus(id: string, status: string): Promise<Proposal> {
  return prisma.proposal.update({ where: { id }, data: { status } });
}

export async function listProposals(
  candidateId: string,
  pagination: Pagination,
): Promise<{ items: Proposal[]; total: number }> {
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.proposal.findMany({
      where: { candidateId },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.proposal.count({ where: { candidateId } }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Audit (non-transactional, best-effort for standalone mutations)
// ---------------------------------------------------------------------------

export function writeAuditLog(entry: AuditLogData): Promise<unknown> {
  return prisma.auditLog.create({ data: entry });
}

// ---------------------------------------------------------------------------
// Conversion (atomic multi-write — keeps the $transaction inside the repo so
// the service never touches the Prisma client directly)
// ---------------------------------------------------------------------------

export function createConsultantFromCandidate(
  data: ConsultantConversionData,
): Promise<{ candidate: Candidate; consultant: Consultant }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        keycloakId: data.keycloakId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: 'CONSULTANT',
      },
    });

    // Race-safe HIRED transition: only flips a candidate that is still
    // VALIDATED. If a concurrent convert already moved it, count === 0 and we
    // abort, preventing a double create (the unique candidateId on Consultant
    // would otherwise surface as an opaque P2002).
    const transition = await tx.candidate.updateMany({
      where: { id: data.candidateId, status: 'VALIDATED' },
      data: { status: 'HIRED' },
    });
    if (transition.count === 0) {
      throw AppError.conflict('Candidate is no longer VALIDATED', { code: 'CONVERSION_RACE' });
    }
    const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: data.candidateId } });

    // Created by recruitment conversion — owned by consultants module from here.
    const consultant = await tx.consultant.create({
      data: {
        userId: user.id,
        candidateId: data.candidateId,
        position: data.position,
        status: 'AVAILABLE',
        ...(data.hireDate ? { hireDate: data.hireDate } : {}),
        ...(data.tjm ? { tjm: data.tjm } : {}),
        ...(data.seniority ? { seniority: data.seniority } : {}),
        ...(data.bio ? { bio: data.bio } : {}),
        ...(data.skillIds ? { skills: { connect: data.skillIds.map((id) => ({ id })) } } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: 'CANDIDATE',
        entityId: data.candidateId,
        action: 'CONVERT',
        actorId: data.actorId,
        payload: { consultantId: consultant.id, userId: user.id },
      },
    });

    return { candidate, consultant };
  });
}
