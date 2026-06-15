import type {
  Assignment,
  AssignmentStatus,
  EntityType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Staffing data-access layer. The ONLY staffing-module file that imports the
 * Prisma client for reads/writes. Pure data access — no business logic.
 *
 * Several functions accept an optional `tx?: Prisma.TransactionClient` so they
 * can participate in the cross-module `$transaction` orchestrated by
 * staffing.service. `const db = tx ?? prisma`.
 *
 * Detail selects never leak consultant PII beyond `user:{firstName,lastName}`
 * + status; `keycloakId`, `email`, `password` etc. are never selected.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface AssignmentFilter {
  missionId?: string;
  consultantId?: string;
  status?: AssignmentStatus;
}

export interface OwnAssignmentFilter {
  status?: AssignmentStatus;
}

export interface CreateAssignmentData {
  missionId: string;
  consultantId: string;
  roleOnMission?: string;
  startDate: Date;
  endDate?: Date;
  allocationPct: number;
}

export interface UpdateAssignmentData {
  roleOnMission?: string;
  startDate?: Date;
  endDate?: Date;
  allocationPct?: number;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

// Detail/list selects — deliberately minimal; no PII beyond first/last name.
const MISSION_SUMMARY_SELECT = {
  id: true,
  project: true,
  status: true,
  client: { select: { name: true } },
} as const;

const CONSULTANT_SUMMARY_SELECT = {
  id: true,
  status: true,
  user: { select: { firstName: true, lastName: true } },
} as const;

const DETAIL_INCLUDE = {
  mission: { select: MISSION_SUMMARY_SELECT },
  consultant: { select: CONSULTANT_SUMMARY_SELECT },
} as const;

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findAssignmentById(id: string): Promise<Assignment | null> {
  return prisma.assignment.findUnique({ where: { id } });
}

export function findAssignmentDetailById(id: string) {
  return prisma.assignment.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listAssignments(
  filter: AssignmentFilter,
  pagination: Pagination,
) {
  const where: Prisma.AssignmentWhereInput = {};
  if (filter.missionId) {
    where.missionId = filter.missionId;
  }
  if (filter.consultantId) {
    where.consultantId = filter.consultantId;
  }
  if (filter.status) {
    where.status = filter.status;
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: DETAIL_INCLUDE,
    }),
    prisma.assignment.count({ where }),
  ]);
  return { items, total };
}

export async function listOwnAssignments(
  userId: string,
  filter: OwnAssignmentFilter,
  pagination: Pagination,
) {
  const where: Prisma.AssignmentWhereInput = { consultant: { userId } };
  if (filter.status) {
    where.status = filter.status;
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { mission: { select: MISSION_SUMMARY_SELECT } },
    }),
    prisma.assignment.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createAssignment(data: CreateAssignmentData) {
  return prisma.assignment.create({
    data,
    include: DETAIL_INCLUDE,
  });
}

export function updateAssignment(id: string, data: UpdateAssignmentData) {
  return prisma.assignment.update({
    where: { id },
    data,
    include: DETAIL_INCLUDE,
  });
}

/** Status update that can participate in a caller-supplied transaction. */
export function updateAssignmentStatusTx(
  id: string,
  status: AssignmentStatus,
  tx?: Prisma.TransactionClient,
): Promise<Assignment> {
  const db = tx ?? prisma;
  return db.assignment.update({ where: { id }, data: { status } });
}

// ---------------------------------------------------------------------------
// Occupancy / capacity
// ---------------------------------------------------------------------------

/**
 * Sum of `allocationPct` over a consultant's ACTIVE assignments, optionally
 * excluding one assignment id (for the "exclude self" capacity check on edit).
 *
 * NOTE: intentionally NOT tx-aware. It is used as a pre-transaction fail-fast
 * capacity read (before the activation/edit `$transaction` opens); reading
 * outside the tx is the deliberate design, not an oversight.
 */
export async function getConsultantActiveAllocationPct(
  consultantId: string,
  excludeAssignmentId?: string,
): Promise<number> {
  const result = await prisma.assignment.aggregate({
    _sum: { allocationPct: true },
    where: {
      consultantId,
      status: 'ACTIVE',
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
  return result._sum.allocationPct ?? 0;
}

export interface OccupancyResult {
  consultantId: string;
  totalAllocationPct: number;
  activeAssignments: { id: string; missionId: string; allocationPct: number }[];
}

export async function getOccupancyForConsultant(
  consultantId: string,
): Promise<OccupancyResult> {
  const rows = await prisma.assignment.findMany({
    where: { consultantId, status: 'ACTIVE' },
    select: { id: true, missionId: true, allocationPct: true },
    orderBy: { createdAt: 'desc' },
  });
  const totalAllocationPct = rows.reduce((sum, r) => sum + r.allocationPct, 0);
  return { consultantId, totalAllocationPct, activeAssignments: rows };
}

/**
 * One row per consultant that has at least one ACTIVE assignment: the consultant
 * summary, their total active allocation, and active-assignment count.
 * Aggregates ACTIVE assignments grouped by consultant, then hydrates names.
 */
export async function listOccupancyByConsultant(pagination: Pagination) {
  const grouped = await prisma.assignment.groupBy({
    by: ['consultantId'],
    where: { status: 'ACTIVE' },
    _sum: { allocationPct: true },
    _count: { _all: true },
  });

  const total = grouped.length;
  const { skip, take } = paginate(pagination);
  // Deterministic order: highest allocation first, then id for stability.
  // TODO(perf): DB-side ordering/pagination when the consultant pool grows.
  grouped.sort((a, b) => {
    const av = a._sum.allocationPct ?? 0;
    const bv = b._sum.allocationPct ?? 0;
    if (bv !== av) return bv - av;
    return a.consultantId.localeCompare(b.consultantId);
  });
  const page = grouped.slice(skip, skip + take);

  const consultants = await prisma.consultant.findMany({
    where: { id: { in: page.map((g) => g.consultantId) } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  const byId = new Map(consultants.map((c) => [c.id, c]));

  const items = page.map((g) => {
    const c = byId.get(g.consultantId);
    const name = c ? `${c.user.firstName} ${c.user.lastName}` : '';
    return {
      consultant: { id: g.consultantId, name },
      totalAllocationPct: g._sum.allocationPct ?? 0,
      assignmentCount: g._count._all,
    };
  });
  return { items, total };
}

// ---------------------------------------------------------------------------
// Suggestions — AVAILABLE consultants whose skills overlap the mission's
// requiredSkills. Pure Prisma (no raw SQL).
// ---------------------------------------------------------------------------

export interface SuggestionItem {
  consultant: { id: string; status: string; firstName: string; lastName: string };
  matchCount: number;
  currentAllocationPct: number;
  matchedSkills: { id: string; name: string }[];
}

export async function findMissionRequiredSkillIds(
  missionId: string,
): Promise<string[] | null> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { requiredSkills: { select: { id: true } } },
  });
  if (!mission) {
    return null;
  }
  return mission.requiredSkills.map((s) => s.id);
}

/**
 * Returns AVAILABLE consultants who have at least one skill in `skillIds`, with
 * their matched skills, match count, and current ACTIVE allocation. Ordering
 * (matchCount DESC, allocation ASC) and pagination are applied by the service.
 */
export async function findAvailableConsultantsForMission(
  skillIds: string[],
): Promise<SuggestionItem[]> {
  if (skillIds.length === 0) {
    return [];
  }
  const consultants = await prisma.consultant.findMany({
    where: {
      status: 'AVAILABLE',
      skills: { some: { id: { in: skillIds } } },
    },
    select: {
      id: true,
      status: true,
      user: { select: { firstName: true, lastName: true } },
      skills: { where: { id: { in: skillIds } }, select: { id: true, name: true } },
      assignments: {
        where: { status: 'ACTIVE' },
        select: { allocationPct: true },
      },
    },
  });

  return consultants.map((c) => ({
    consultant: {
      id: c.id,
      status: c.status,
      firstName: c.user.firstName,
      lastName: c.user.lastName,
    },
    matchCount: c.skills.length,
    currentAllocationPct: c.assignments.reduce((s, a) => s + a.allocationPct, 0),
    matchedSkills: c.skills,
  }));
}

// ---------------------------------------------------------------------------
// Audit (tx-aware so it can join the cross-module transaction)
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  entry: AuditLogData,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({ data: entry });
}
