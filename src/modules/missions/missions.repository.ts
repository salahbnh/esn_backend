import type {
  EntityType,
  Mission,
  MissionAmendment,
  MissionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Missions data-access layer. The ONLY missions-module file that imports the
 * Prisma client. No business logic — pure, deliberate data access.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface MissionFilter {
  status?: MissionStatus;
  clientId?: string;
  skillId?: string;
  search?: string;
  includeArchived: boolean;
}

export interface CreateMissionData {
  clientId: string;
  project: string;
  role: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  tjm: string;
  requiredSkillIds: string[];
}

export interface UpdateMissionData {
  clientId?: string;
  project?: string;
  role?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  tjm?: string;
  requiredSkillIds?: string[];
}

export interface CreateAmendmentData {
  missionId: string;
  reason: string;
  changes: Record<string, unknown>;
  effectiveDate: Date;
  createdById: string;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

const CLIENT_DETAIL_SELECT = {
  id: true,
  name: true,
  industry: true,
  contactName: true,
  contactEmail: true,
} as const;

const CLIENT_LIST_SELECT = { id: true, name: true } as const;

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findMissionById(id: string): Promise<Mission | null> {
  return prisma.mission.findUnique({ where: { id } });
}

/** Lightweight existence check for 404 guards. */
export async function missionExists(id: string): Promise<boolean> {
  const row = await prisma.mission.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

type MissionWithDetailRelations = Prisma.MissionGetPayload<{
  include: {
    client: { select: typeof CLIENT_DETAIL_SELECT };
    requiredSkills: true;
  };
}>;

/**
 * Assembles the detail shape (client + requiredSkills + computed counts) for an
 * already-loaded mission row. Counts are fetched in parallel — never over-fetch.
 */
async function assembleMissionDetail(mission: MissionWithDetailRelations) {
  const [activeAssignmentCount, totalAssignmentCount, amendmentCount] = await Promise.all([
    prisma.assignment.count({ where: { missionId: mission.id, status: 'ACTIVE' } }),
    prisma.assignment.count({ where: { missionId: mission.id } }),
    prisma.missionAmendment.count({ where: { missionId: mission.id } }),
  ]);
  return {
    ...mission,
    _activeAssignmentCount: activeAssignmentCount,
    _totalAssignmentCount: totalAssignmentCount,
    _amendmentCount: amendmentCount,
  };
}

export async function findMissionDetailById(id: string) {
  const mission = await prisma.mission.findUnique({
    where: { id },
    include: {
      client: { select: CLIENT_DETAIL_SELECT },
      requiredSkills: true,
    },
  });
  if (!mission) {
    return null;
  }
  return assembleMissionDetail(mission);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listMissions(filter: MissionFilter, pagination: Pagination) {
  const where: Prisma.MissionWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  if (!filter.includeArchived) {
    where.archivedAt = null;
  }
  if (filter.clientId) {
    where.clientId = filter.clientId;
  }
  if (filter.skillId) {
    where.requiredSkills = { some: { id: filter.skillId } };
  }
  if (filter.search) {
    where.OR = [
      { project: { contains: filter.search, mode: 'insensitive' } },
      { role: { contains: filter.search, mode: 'insensitive' } },
      { client: { name: { contains: filter.search, mode: 'insensitive' } } },
    ];
  }

  const { skip, take } = paginate(pagination);
  const [rows, total] = await Promise.all([
    prisma.mission.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: CLIENT_LIST_SELECT },
        _count: { select: { assignments: { where: { status: 'ACTIVE' } } } },
      },
    }),
    prisma.mission.count({ where }),
  ]);
  // Expose the ACTIVE-assignment count as `_assignmentCount`; strip the raw `_count`.
  const items = rows.map(({ _count, ...mission }) => ({
    ...mission,
    _assignmentCount: _count.assignments,
  }));
  return { items, total };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createMission(data: CreateMissionData) {
  const { requiredSkillIds, ...rest } = data;
  return prisma.mission.create({
    data: {
      ...rest,
      requiredSkills: { connect: requiredSkillIds.map((sid) => ({ id: sid })) },
    },
    include: {
      client: { select: CLIENT_DETAIL_SELECT },
      requiredSkills: true,
    },
  });
}

export function updateMission(id: string, data: UpdateMissionData) {
  const { requiredSkillIds, ...rest } = data;
  return prisma.mission.update({
    where: { id },
    data: {
      ...rest,
      ...(requiredSkillIds
        ? { requiredSkills: { set: requiredSkillIds.map((sid) => ({ id: sid })) } }
        : {}),
    },
    include: {
      client: { select: CLIENT_DETAIL_SELECT },
      requiredSkills: true,
    },
  });
}

export function updateMissionStatus(id: string, status: MissionStatus): Promise<Mission> {
  return prisma.mission.update({ where: { id }, data: { status } });
}

// ---------------------------------------------------------------------------
// Transaction-aware helpers (used by staffing.service's cross-module $transaction)
// ---------------------------------------------------------------------------

/** Fetch just a mission's current status (for the staffing hook), tx-aware. */
export async function findMissionStatusTx(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<MissionStatus | null> {
  const db = tx ?? prisma;
  const row = await db.mission.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

/** Status update that can participate in a caller-supplied transaction. */
export function updateMissionStatusTx(
  id: string,
  status: MissionStatus,
  tx?: Prisma.TransactionClient,
): Promise<Mission> {
  const db = tx ?? prisma;
  return db.mission.update({ where: { id }, data: { status } });
}

/**
 * Ownership resolver source: returns the owning consultant's userId if the
 * given user has any assignment on the mission, else null. Lives in MISSIONS
 * so the missions module never needs to import staffing.
 */
export async function findMissionAssignmentOwnerUserId(
  missionId: string,
  userId: string,
): Promise<string | null> {
  const assignment = await prisma.assignment.findFirst({
    where: { missionId, consultant: { userId } },
    select: { consultant: { select: { userId: true } } },
  });
  return assignment?.consultant.userId ?? null;
}

export function archiveMission(id: string): Promise<Mission> {
  return prisma.mission.update({
    where: { id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

export function createAmendment(data: CreateAmendmentData): Promise<MissionAmendment> {
  return prisma.missionAmendment.create({
    data: { ...data, changes: data.changes as Prisma.InputJsonValue },
  });
}

export async function listAmendments(missionId: string, pagination: Pagination) {
  const where: Prisma.MissionAmendmentWhereInput = { missionId };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.missionAmendment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.missionAmendment.count({ where }),
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
