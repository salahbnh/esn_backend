import type { Assignment, AssignmentStatus } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
// DOCUMENTED CROSS-MODULE EXCEPTION: the staffing service is the ONE service
// allowed to import the prisma client, and SOLELY to open the cross-module
// `$transaction` that spans missions + consultants single-writer hooks. All
// actual reads/writes still go through repository functions (passed the `tx`).
import { prisma } from '../../lib/prisma.js';
import * as repo from './staffing.repository.js';
import type { Pagination } from './staffing.repository.js';
import * as missionsService from '../missions/missions.service.js';
import * as consultantsService from '../consultants/consultants.service.js';
import type {
  CreateAssignmentBody,
  ListAssignmentsQuery,
  OwnAssignmentsQuery,
  SuggestionsQuery,
  UpdateAssignmentBody,
} from './staffing.schema.js';

/**
 * Staffing / Affectation business logic: assignment CRUD, the assignment status
 * state machine, the capacity (over-allocation) guard, occupancy reads, and the
 * skill-overlap suggestion read. Throws AppError on domain violations.
 *
 * This service owns the cross-module `$transaction` for status transitions that
 * cascade into mission + consultant status (the single-writer hooks live in
 * their own modules — staffing never writes those tables directly).
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

type AssignmentDetail = NonNullable<
  Awaited<ReturnType<typeof repo.findAssignmentDetailById>>
>;
type AssignmentListItem = Awaited<ReturnType<typeof repo.listAssignments>>['items'][number];
type OwnAssignmentItem = Awaited<
  ReturnType<typeof repo.listOwnAssignments>
>['items'][number];
type OccupancyListItem = Awaited<
  ReturnType<typeof repo.listOccupancyByConsultant>
>['items'][number];

/**
 * Assignment status state machine (plan §3):
 *   PROPOSED  → CONFIRMED
 *   CONFIRMED → ACTIVE | PROPOSED   (de-confirm / re-propose)
 *   ACTIVE    → ENDED
 *   ENDED     → (terminal)
 * Same-state and unknown targets are rejected (not in the allowed list).
 */
const ALLOWED_STATUS_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  PROPOSED: ['CONFIRMED'],
  CONFIRMED: ['ACTIVE', 'PROPOSED'],
  ACTIVE: ['ENDED'],
  ENDED: [],
};

const MAX_ALLOCATION_PCT = 100;

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadAssignmentOr404(id: string): Promise<Assignment> {
  const assignment = await repo.findAssignmentById(id);
  if (!assignment) {
    throw AppError.notFound('Assignment not found');
  }
  return assignment;
}

async function loadAssignmentDetailOr404(id: string): Promise<AssignmentDetail> {
  const assignment = await repo.findAssignmentDetailById(id);
  if (!assignment) {
    throw AppError.notFound('Assignment not found');
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createAssignment(
  body: CreateAssignmentBody,
  actorId: string,
): Promise<AssignmentDetail> {
  // Mission must exist and be staffable (not CLOSED/ARCHIVED). No capacity
  // check at create — a PROPOSED assignment consumes no active capacity (D4).
  const missionStatus = await missionsService.getMissionStatusOrNull(body.missionId);
  if (missionStatus === null) {
    throw AppError.notFound('Mission not found');
  }
  if (missionStatus === 'CLOSED' || missionStatus === 'ARCHIVED') {
    throw AppError.badRequest('Cannot assign to a closed/archived mission', {
      code: 'MISSION_NOT_STAFFABLE',
      status: missionStatus,
    });
  }

  if (!(await consultantsService.consultantExists(body.consultantId))) {
    throw AppError.notFound('Consultant not found');
  }

  const created = await repo.createAssignment({
    missionId: body.missionId,
    consultantId: body.consultantId,
    ...(body.roleOnMission !== undefined ? { roleOnMission: body.roleOnMission } : {}),
    startDate: new Date(body.startDate),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    allocationPct: body.allocationPct,
  });

  await repo.writeAuditLog({
    entityType: 'ASSIGNMENT',
    entityId: created.id,
    action: 'CREATE',
    actorId,
    payload: {
      missionId: body.missionId,
      consultantId: body.consultantId,
      allocationPct: body.allocationPct,
    },
  });
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAssignments(
  query: ListAssignmentsQuery,
): Promise<PaginatedResult<AssignmentListItem>> {
  const { items, total } = await repo.listAssignments(
    {
      ...(query.missionId !== undefined ? { missionId: query.missionId } : {}),
      ...(query.consultantId !== undefined ? { consultantId: query.consultantId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function getAssignment(id: string): Promise<AssignmentDetail> {
  return loadAssignmentDetailOr404(id);
}

export async function listOwnAssignments(
  userId: string,
  query: OwnAssignmentsQuery,
): Promise<PaginatedResult<OwnAssignmentItem>> {
  const { items, total } = await repo.listOwnAssignments(
    userId,
    { ...(query.status !== undefined ? { status: query.status } : {}) },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

// ---------------------------------------------------------------------------
// Update (mutable fields) — capacity guard fires only on allocationPct change
// of an already-ACTIVE assignment (D4 case b).
// ---------------------------------------------------------------------------

export async function updateAssignment(
  id: string,
  body: UpdateAssignmentBody,
  actorId: string,
): Promise<AssignmentDetail> {
  const assignment = await loadAssignmentOr404(id);

  if (
    assignment.status === 'ACTIVE' &&
    body.allocationPct !== undefined &&
    body.allocationPct !== assignment.allocationPct &&
    !body.force
  ) {
    const othersPct = await repo.getConsultantActiveAllocationPct(
      assignment.consultantId,
      id, // exclude self
    );
    if (othersPct + body.allocationPct > MAX_ALLOCATION_PCT) {
      throw AppError.badRequest('Consultant would be over-allocated', {
        code: 'OVER_ALLOCATED',
        currentOtherPct: othersPct,
        requestedPct: body.allocationPct,
      });
    }
  }

  const updated = await repo.updateAssignment(id, {
    ...(body.roleOnMission !== undefined ? { roleOnMission: body.roleOnMission } : {}),
    ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    ...(body.allocationPct !== undefined ? { allocationPct: body.allocationPct } : {}),
  });

  await repo.writeAuditLog({
    entityType: 'ASSIGNMENT',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body).filter((k) => k !== 'force') },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Status transition + cross-module cascade
// ---------------------------------------------------------------------------

export async function changeAssignmentStatus(
  id: string,
  toStatus: AssignmentStatus,
  comment: string | undefined,
  force: boolean,
  actorId: string,
): Promise<Assignment> {
  const assignment = await loadAssignmentOr404(id);

  const allowed = ALLOWED_STATUS_TRANSITIONS[assignment.status];
  if (!allowed.includes(toStatus)) {
    throw AppError.badRequest(
      `Cannot transition assignment from ${assignment.status} to ${toStatus}`,
      { code: 'INVALID_TRANSITION', from: assignment.status, to: toStatus },
    );
  }

  if (toStatus === 'ACTIVE') {
    return activateAssignment(assignment, comment, force, actorId);
  }
  if (toStatus === 'ENDED') {
    return endAssignment(assignment, comment, actorId);
  }
  return simpleStatusChange(assignment, toStatus, comment, actorId);
}

/** CONFIRMED → ACTIVE: capacity guard, then the atomic mission+consultant cascade. */
async function activateAssignment(
  assignment: Assignment,
  comment: string | undefined,
  force: boolean,
  actorId: string,
): Promise<Assignment> {
  if (!force) {
    const othersPct = await repo.getConsultantActiveAllocationPct(
      assignment.consultantId,
      assignment.id, // exclude self (defensive; a non-ACTIVE row contributes 0 anyway)
    );
    if (othersPct + assignment.allocationPct > MAX_ALLOCATION_PCT) {
      throw AppError.badRequest('Consultant would be over-allocated', {
        code: 'OVER_ALLOCATED',
        currentOtherPct: othersPct,
        requestedPct: assignment.allocationPct,
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await repo.updateAssignmentStatusTx(assignment.id, 'ACTIVE', tx);
    // Hooks may throw (e.g. mission CLOSED) → whole transaction rolls back.
    await missionsService.setMissionStaffed(assignment.missionId, actorId, tx);
    await consultantsService.setConsultantOnMission(assignment.consultantId, actorId, tx);
    await repo.writeAuditLog(
      {
        entityType: 'ASSIGNMENT',
        entityId: assignment.id,
        action: 'STATUS_CHANGE',
        actorId,
        payload: { from: assignment.status, to: 'ACTIVE', comment: comment ?? null },
      },
      tx,
    );
    return updated;
  });
}

/** ACTIVE → ENDED: end the assignment, then bench the consultant if now idle. */
async function endAssignment(
  assignment: Assignment,
  comment: string | undefined,
  actorId: string,
): Promise<Assignment> {
  return prisma.$transaction(async (tx) => {
    const updated = await repo.updateAssignmentStatusTx(assignment.id, 'ENDED', tx);
    // Status is now ENDED in-tx, so this assignment no longer counts as ACTIVE.
    await consultantsService.setConsultantIntercontratIfIdle(
      assignment.consultantId,
      actorId,
      tx,
    );
    await repo.writeAuditLog(
      {
        entityType: 'ASSIGNMENT',
        entityId: assignment.id,
        action: 'STATUS_CHANGE',
        actorId,
        payload: { from: assignment.status, to: 'ENDED', comment: comment ?? null },
      },
      tx,
    );
    return updated;
  });
}

/** Transitions with no cross-module effect (PROPOSED↔CONFIRMED): plain update. */
async function simpleStatusChange(
  assignment: Assignment,
  toStatus: AssignmentStatus,
  comment: string | undefined,
  actorId: string,
): Promise<Assignment> {
  const updated = await repo.updateAssignmentStatusTx(assignment.id, toStatus);
  await repo.writeAuditLog({
    entityType: 'ASSIGNMENT',
    entityId: assignment.id,
    action: 'STATUS_CHANGE',
    actorId,
    payload: { from: assignment.status, to: toStatus, comment: comment ?? null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export async function getConsultantOccupancy(
  consultantId: string,
): Promise<repo.OccupancyResult> {
  if (!(await consultantsService.consultantExists(consultantId))) {
    throw AppError.notFound('Consultant not found');
  }
  return repo.getOccupancyForConsultant(consultantId);
}

export async function listGlobalOccupancy(
  pagination: Pagination,
): Promise<PaginatedResult<OccupancyListItem>> {
  const { items, total } = await repo.listOccupancyByConsultant(pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export async function suggestConsultantsForMission(query: SuggestionsQuery) {
  const skillIds = await repo.findMissionRequiredSkillIds(query.missionId);
  if (skillIds === null) {
    throw AppError.notFound('Mission not found');
  }

  const all = await repo.findAvailableConsultantsForMission(skillIds);
  // Order: matchCount DESC, then currentAllocationPct ASC.
  // TODO(perf): DB-side ordering/pagination when the consultant pool grows.
  all.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return a.currentAllocationPct - b.currentAllocationPct;
  });

  const total = all.length;
  const start = (query.page - 1) * query.pageSize;
  const items = all.slice(start, start + query.pageSize);
  return paginated(items, total, query.page, query.pageSize);
}
