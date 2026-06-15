import type { Mission, MissionStatus, Prisma, Role } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './missions.repository.js';
import type { Pagination } from './missions.repository.js';
import type {
  CreateAmendmentBody,
  CreateMissionBody,
  ListMissionsQuery,
  UpdateMissionBody,
} from './missions.schema.js';

/**
 * Missions business logic: CRUD, the status state machine, archival, and
 * amendments. Throws AppError on domain violations. Never imports the Prisma
 * client. This service is the SINGLE writer of `Mission.status`.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// Concrete list-item types derived from the repository return shapes.
type MissionListItem = Awaited<ReturnType<typeof repo.listMissions>>['items'][number];
type AmendmentListItem = Awaited<ReturnType<typeof repo.listAmendments>>['items'][number];

/**
 * Enforced mission status state machine (plan §0a):
 *   DRAFT       → STAFFED
 *   STAFFED     → IN_PROGRESS | DRAFT
 *   IN_PROGRESS → CLOSED
 *   CLOSED      → (terminal)
 *   ARCHIVED    → (terminal — only reachable via the /archive endpoint)
 *
 * There is NO DRAFT → IN_PROGRESS shortcut: a mission MUST be STAFFED before it
 * starts. Same-state and any transition INTO ARCHIVED via /status are rejected.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  DRAFT: ['STAFFED'],
  STAFFED: ['IN_PROGRESS', 'DRAFT'],
  IN_PROGRESS: ['CLOSED'],
  CLOSED: [],
  ARCHIVED: [],
};

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadMissionOr404(id: string): Promise<Mission> {
  const mission = await repo.findMissionById(id);
  if (!mission) {
    throw AppError.notFound('Mission not found');
  }
  return mission;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMissions(
  query: ListMissionsQuery,
): Promise<PaginatedResult<MissionListItem>> {
  // Filtering by status=ARCHIVED must include archived rows, otherwise the
  // archivedAt-is-null guard would silently return zero results.
  const includeArchived = query.includeArchived || query.status === 'ARCHIVED';
  const { items, total } = await repo.listMissions(
    {
      status: query.status,
      clientId: query.clientId,
      skillId: query.skillId,
      search: query.search,
      includeArchived,
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

/**
 * Mission detail. When the requester is a CONSULTANT (own-assigned read), the
 * commercial fields (`tjm`, client `contactName`/`contactEmail`) are stripped —
 * a consultant must not see client-billed rate or client contact data
 * (api-design.md: never expose internal fields the role isn't authorized to see).
 */
export async function getMission(id: string, role: Role) {
  const mission = await repo.findMissionDetailById(id);
  if (!mission) {
    throw AppError.notFound('Mission not found');
  }
  if (role === 'CONSULTANT') {
    const { client, ...rest } = mission;
    return {
      ...rest,
      tjm: undefined,
      client: {
        id: client.id,
        name: client.name,
        industry: client.industry,
        contactName: undefined,
        contactEmail: undefined,
      },
    };
  }
  return mission;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createMission(body: CreateMissionBody, actorId: string) {
  const mission = await repo.createMission({
    clientId: body.clientId,
    project: body.project,
    role: body.role,
    ...(body.description !== undefined ? { description: body.description } : {}),
    startDate: new Date(body.startDate),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    tjm: body.tjm,
    requiredSkillIds: body.requiredSkillIds,
  });

  await repo.writeAuditLog({
    entityType: 'MISSION',
    entityId: mission.id,
    action: 'CREATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return mission;
}

export async function updateMission(
  id: string,
  body: UpdateMissionBody,
  actorId: string,
) {
  await loadMissionOr404(id);

  const mission = await repo.updateMission(id, {
    ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    ...(body.project !== undefined ? { project: body.project } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    ...(body.tjm !== undefined ? { tjm: body.tjm } : {}),
    ...(body.requiredSkillIds !== undefined
      ? { requiredSkillIds: body.requiredSkillIds }
      : {}),
  });

  await repo.writeAuditLog({
    entityType: 'MISSION',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return mission;
}

// ---------------------------------------------------------------------------
// Status transition
// ---------------------------------------------------------------------------

export async function changeStatus(
  id: string,
  toStatus: MissionStatus,
  comment: string | undefined,
  actorId: string,
): Promise<Mission> {
  const mission = await loadMissionOr404(id);

  // NOTE: the programmatic STAFFED advance driven by the Staffing module lives
  // in `setMissionStaffed` below (called inside staffing's $transaction). This
  // user-driven path keeps enforcing the interactive state machine.
  const allowed = ALLOWED_STATUS_TRANSITIONS[mission.status];
  if (!allowed.includes(toStatus)) {
    throw AppError.badRequest(
      `Cannot transition mission from ${mission.status} to ${toStatus}`,
      { code: 'INVALID_TRANSITION', from: mission.status, to: toStatus },
    );
  }

  const updated = await repo.updateMissionStatus(id, toStatus);
  await repo.writeAuditLog({
    entityType: 'MISSION',
    entityId: id,
    action: 'STATUS_CHANGE',
    actorId,
    payload: { from: mission.status, to: toStatus, comment: comment ?? null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Cross-module hooks (called by staffing.service inside its $transaction)
// ---------------------------------------------------------------------------

/**
 * Advance the mission to STAFFED when one of its assignments activates.
 * Programmatic hook (bypasses the user-facing state machine): DRAFT → STAFFED
 * (+ audit); STAFFED/IN_PROGRESS → no-op; CLOSED/ARCHIVED → badRequest (rolls
 * back the activating transaction). This service stays the single writer of
 * `Mission.status`.
 */
export async function setMissionStaffed(
  missionId: string,
  actorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const status = await repo.findMissionStatusTx(missionId, tx);
  if (status === null) {
    throw AppError.notFound('Mission not found');
  }
  if (status === 'STAFFED' || status === 'IN_PROGRESS') {
    return; // idempotent — already staffed/started
  }
  if (status === 'CLOSED' || status === 'ARCHIVED') {
    throw AppError.badRequest('Cannot staff a closed/archived mission', {
      code: 'MISSION_NOT_STAFFABLE',
      status,
    });
  }
  // status === 'DRAFT'
  await repo.updateMissionStatusTx(missionId, 'STAFFED', tx);
  await repo.writeAuditLog(
    {
      entityType: 'MISSION',
      entityId: missionId,
      action: 'STATUS_CHANGE',
      actorId,
      payload: { from: status, to: 'STAFFED', via: 'assignment' },
    },
    tx,
  );
}

/**
 * Pre-check read for the Staffing module's assignment-create guard: returns the
 * mission's current status, or null if it does not exist. Exposed as a SERVICE
 * function so staffing calls a foreign service (not its repository) for the
 * cross-module pre-condition read.
 */
export function getMissionStatusOrNull(id: string): Promise<MissionStatus | null> {
  return repo.findMissionStatusTx(id);
}

/**
 * Ownership resolver for `GET /api/missions/:id` when the caller is a
 * CONSULTANT: returns the owning userId if the consultant has an assignment on
 * the mission, else null. Lives in MISSIONS so missions never imports staffing.
 */
export function resolveMissionOwnerForConsultant(
  missionId: string,
  userId: string,
): Promise<string | null> {
  return repo.findMissionAssignmentOwnerUserId(missionId, userId);
}

// ---------------------------------------------------------------------------
// Archive (idempotent)
// ---------------------------------------------------------------------------

export async function archiveMission(id: string, actorId: string): Promise<Mission> {
  const mission = await loadMissionOr404(id);

  // Idempotent: if already archived, return it without a second write or audit.
  if (mission.status === 'ARCHIVED') {
    return mission;
  }

  const updated = await repo.archiveMission(id);
  await repo.writeAuditLog({
    entityType: 'MISSION',
    entityId: id,
    action: 'ARCHIVE',
    actorId,
    payload: { from: mission.status, to: 'ARCHIVED' },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

export async function createAmendment(
  missionId: string,
  body: CreateAmendmentBody,
  actorId: string,
) {
  await loadMissionOr404(missionId);

  const amendment = await repo.createAmendment({
    missionId,
    reason: body.reason,
    changes: body.changes,
    effectiveDate: new Date(body.effectiveDate),
    createdById: actorId,
  });

  await repo.writeAuditLog({
    entityType: 'MISSION',
    entityId: missionId,
    action: 'AMENDMENT_CREATE',
    actorId,
    payload: { amendment: amendment.id, reason: body.reason },
  });
  return amendment;
}

export async function listAmendments(
  missionId: string,
  pagination: Pagination,
): Promise<PaginatedResult<AmendmentListItem>> {
  if (!(await repo.missionExists(missionId))) {
    throw AppError.notFound('Mission not found');
  }
  const { items, total } = await repo.listAmendments(missionId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}
