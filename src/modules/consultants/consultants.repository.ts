import type {
  Consultant,
  ConsultantStatus,
  EntityType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Consultants data-access layer. The ONLY module file that imports the Prisma
 * client. No business logic here — pure, deliberate data access. Never selects
 * `storageKey` on documents (internal-only).
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface ConsultantFilter {
  status?: ConsultantStatus;
  skillId?: string;
  search?: string;
}

export interface UpdateConsultantData {
  position?: string;
  tjm?: string;
  seniority?: string;
  bio?: string;
  availabilityDate?: Date;
  skillIds?: string[];
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

const USER_PUBLIC_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
} as const;

const DOCUMENT_META_SELECT = {
  id: true,
  type: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findConsultantById(id: string): Promise<Consultant | null> {
  return prisma.consultant.findUnique({ where: { id } });
}

export function findConsultantByUserId(userId: string) {
  return prisma.consultant.findUnique({
    where: { userId },
    include: { user: { select: USER_PUBLIC_SELECT }, skills: true },
  });
}

type ConsultantWithRelations = Prisma.ConsultantGetPayload<{
  include: { user: { select: typeof USER_PUBLIC_SELECT }; skills: true };
}>;

/**
 * Assembles the detail shape (relations + computed `_assignmentCount` + document
 * metadata) for an already-loaded consultant row. Documents are polymorphic
 * (entityType + entityId), not a Prisma relation — fetched separately.
 * `storageKey` is never selected.
 */
async function assembleConsultantDetail(consultant: ConsultantWithRelations) {
  const [assignmentCount, documents] = await Promise.all([
    prisma.assignment.count({
      where: { consultantId: consultant.id, status: 'ACTIVE' },
    }),
    prisma.document.findMany({
      where: { entityType: 'CONSULTANT', entityId: consultant.id },
      select: DOCUMENT_META_SELECT,
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return { ...consultant, _assignmentCount: assignmentCount, documents };
}

export async function findConsultantDetailById(id: string) {
  const consultant = await prisma.consultant.findUnique({
    where: { id },
    include: {
      user: { select: USER_PUBLIC_SELECT },
      skills: true,
    },
  });
  if (!consultant) {
    return null;
  }
  return assembleConsultantDetail(consultant);
}

/** Same detail assembly as `findConsultantDetailById`, looked up by `userId` (for `/me`). */
export async function findConsultantDetailByUserId(userId: string) {
  const consultant = await prisma.consultant.findUnique({
    where: { userId },
    include: {
      user: { select: USER_PUBLIC_SELECT },
      skills: true,
    },
  });
  if (!consultant) {
    return null;
  }
  return assembleConsultantDetail(consultant);
}

/** Minimal fetch for the ownership resolver — only the owning userId. */
export function findConsultantUserIdById(
  id: string,
): Promise<{ userId: string } | null> {
  return prisma.consultant.findUnique({ where: { id }, select: { userId: true } });
}

/** Resolve a consultant's Keycloak sub (for re-sending the set-password invite). */
export function findConsultantKeycloakId(
  id: string,
): Promise<{ user: { keycloakId: string } } | null> {
  return prisma.consultant.findUnique({
    where: { id },
    select: { user: { select: { keycloakId: true } } },
  });
}

/** Lightweight existence check (no PII) for 404 guards. */
export async function consultantExists(id: string): Promise<boolean> {
  const row = await prisma.consultant.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listConsultants(
  filter: ConsultantFilter,
  pagination: Pagination,
) {
  const where: Prisma.ConsultantWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  if (filter.skillId) {
    where.skills = { some: { id: filter.skillId } };
  }
  if (filter.search) {
    where.OR = [
      { user: { firstName: { contains: filter.search, mode: 'insensitive' } } },
      { user: { lastName: { contains: filter.search, mode: 'insensitive' } } },
      { position: { contains: filter.search, mode: 'insensitive' } },
    ];
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.consultant.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: USER_PUBLIC_SELECT }, skills: true },
    }),
    prisma.consultant.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function updateConsultant(id: string, data: UpdateConsultantData) {
  const { skillIds, ...rest } = data;
  return prisma.consultant.update({
    where: { id },
    data: {
      ...rest,
      ...(skillIds ? { skills: { set: skillIds.map((sid) => ({ id: sid })) } } : {}),
    },
    include: { user: { select: USER_PUBLIC_SELECT }, skills: true },
  });
}

export function updateConsultantStatus(
  id: string,
  status: ConsultantStatus,
): Promise<Consultant> {
  return prisma.consultant.update({ where: { id }, data: { status } });
}

// ---------------------------------------------------------------------------
// Transaction-aware helpers (used by staffing.service's cross-module $transaction)
// ---------------------------------------------------------------------------

/** Fetch just a consultant's current status (for the staffing hooks), tx-aware. */
export async function findConsultantStatusTx(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<{ status: ConsultantStatus } | null> {
  const db = tx ?? prisma;
  return db.consultant.findUnique({ where: { id }, select: { status: true } });
}

/** Status update that can participate in a caller-supplied transaction. */
export function updateConsultantStatusTx(
  id: string,
  status: ConsultantStatus,
  tx?: Prisma.TransactionClient,
): Promise<Consultant> {
  const db = tx ?? prisma;
  return db.consultant.update({ where: { id }, data: { status } });
}

/**
 * Counts a consultant's ACTIVE assignments, optionally excluding one assignment
 * id (e.g. the one being ended). Used to decide the INTERCONTRAT-if-idle hook.
 */
export function countActiveAssignmentsTx(
  consultantId: string,
  excludeAssignmentId: string | undefined,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const db = tx ?? prisma;
  return db.assignment.count({
    where: {
      consultantId,
      status: 'ACTIVE',
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Documents metadata (NO storageKey)
// ---------------------------------------------------------------------------

export async function listConsultantDocuments(
  consultantId: string,
  pagination: Pagination,
) {
  const where: Prisma.DocumentWhereInput = {
    entityType: 'CONSULTANT',
    entityId: consultantId,
  };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: DOCUMENT_META_SELECT,
    }),
    prisma.document.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Audit (non-transactional, best-effort for standalone mutations)
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  entry: AuditLogData,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({ data: entry });
}
