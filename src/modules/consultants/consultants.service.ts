import type { Consultant, ConsultantStatus, Prisma } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import { resendInvite } from '../../lib/keycloak-admin.js';
import * as repo from './consultants.repository.js';
import type { Pagination } from './consultants.repository.js';
import type {
  ListConsultantsQuery,
  UpdateConsultantBody,
  UpdateOwnProfileBody,
} from './consultants.schema.js';

/**
 * Consultants business logic: profile reads/updates, the status state machine,
 * self-service profile edits, and document-metadata listing. Throws AppError on
 * domain violations. Never imports the Prisma client.
 *
 * This service is the SINGLE writer of `Consultant.status` (plan §0 R1).
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// Concrete list-item types derived from the repository return shapes — keeps the
// HTTP contract typed end-to-end (no `unknown` leaking into responses).
type ConsultantListItem = Awaited<ReturnType<typeof repo.listConsultants>>['items'][number];
type DocumentMetaItem = Awaited<
  ReturnType<typeof repo.listConsultantDocuments>
>['items'][number];

/**
 * Consultant status state machine. All statuses are reversible — there are NO
 * terminal states (unlike the candidate pipeline). Same-state and unknown
 * targets are rejected because they are not present in the allowed list.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<ConsultantStatus, ConsultantStatus[]> = {
  AVAILABLE: ['INTERCONTRAT', 'ON_MISSION'],
  INTERCONTRAT: ['AVAILABLE', 'ON_MISSION'],
  ON_MISSION: ['AVAILABLE', 'INTERCONTRAT'],
};

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadConsultantOr404(id: string): Promise<Consultant> {
  const consultant = await repo.findConsultantById(id);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }
  return consultant;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listConsultants(
  query: ListConsultantsQuery,
): Promise<PaginatedResult<ConsultantListItem>> {
  const { items, total } = await repo.listConsultants(
    { status: query.status, skillId: query.skillId, search: query.search },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function getConsultant(id: string) {
  const consultant = await repo.findConsultantDetailById(id);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }
  return consultant;
}

export async function getOwnProfile(userId: string) {
  const consultant = await repo.findConsultantDetailByUserId(userId);
  if (!consultant) {
    throw AppError.notFound('Consultant profile not found');
  }
  return consultant;
}

/**
 * Existence pre-check for foreign modules (e.g. the Staffing assignment-create
 * guard). Exposed as a SERVICE function so callers go through the service layer
 * rather than reaching into the consultants repository directly.
 */
export function consultantExists(id: string): Promise<boolean> {
  return repo.consultantExists(id);
}

/**
 * Resolves the owning `User.id` for the consultant targeted by `id` (the route
 * param), or null if it cannot be resolved. Used by the declarative ownership
 * gate on `GET /:id/documents`. Never trusts the body — resolved from the DB.
 */
export async function resolveConsultantOwnerId(id: string): Promise<string | null> {
  return (await repo.findConsultantUserIdById(id))?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export async function updateConsultant(
  id: string,
  body: UpdateConsultantBody,
  actorId: string,
) {
  await loadConsultantOr404(id);

  const consultant = await repo.updateConsultant(id, {
    ...(body.position !== undefined ? { position: body.position } : {}),
    ...(body.tjm !== undefined ? { tjm: body.tjm } : {}),
    ...(body.seniority !== undefined ? { seniority: body.seniority } : {}),
    ...(body.bio !== undefined ? { bio: body.bio } : {}),
    ...(body.availabilityDate !== undefined
      ? { availabilityDate: new Date(body.availabilityDate) }
      : {}),
    ...(body.skillIds !== undefined ? { skillIds: body.skillIds } : {}),
  });

  await repo.writeAuditLog({
    entityType: 'CONSULTANT',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return consultant;
}

export async function updateOwnProfile(userId: string, body: UpdateOwnProfileBody) {
  const existing = await repo.findConsultantByUserId(userId);
  if (!existing) {
    throw AppError.notFound('Consultant profile not found');
  }

  // Only the consultant-authored fields reach the repo — the narrow schema
  // already rejects administrative fields (position/tjm/status/availabilityDate).
  const consultant = await repo.updateConsultant(existing.id, {
    ...(body.bio !== undefined ? { bio: body.bio } : {}),
    ...(body.seniority !== undefined ? { seniority: body.seniority } : {}),
    ...(body.skillIds !== undefined ? { skillIds: body.skillIds } : {}),
  });

  // For self-edits the actor IS the owning user — use `userId` for the audit.
  await repo.writeAuditLog({
    entityType: 'CONSULTANT',
    entityId: existing.id,
    action: 'UPDATE',
    actorId: userId,
    payload: { fields: Object.keys(body), self: true },
  });
  return consultant;
}

// ---------------------------------------------------------------------------
// Status transition
// ---------------------------------------------------------------------------

export async function changeStatus(
  id: string,
  toStatus: ConsultantStatus,
  comment: string | undefined,
  actorId: string,
): Promise<Consultant> {
  const consultant = await loadConsultantOr404(id);

  // NOTE: the programmatic status writes driven by the Staffing module live in
  // `setConsultantOnMission` / `setConsultantIntercontratIfIdle` below (called
  // inside staffing's $transaction). This user-driven path keeps enforcing the
  // interactive state machine.
  const allowed = ALLOWED_STATUS_TRANSITIONS[consultant.status];
  if (!allowed.includes(toStatus)) {
    throw AppError.badRequest(
      `Cannot transition consultant from ${consultant.status} to ${toStatus}`,
      { code: 'INVALID_TRANSITION', from: consultant.status, to: toStatus },
    );
  }

  const updated = await repo.updateConsultantStatus(id, toStatus);
  await repo.writeAuditLog({
    entityType: 'CONSULTANT',
    entityId: id,
    action: 'STATUS_CHANGE',
    actorId,
    payload: { from: consultant.status, to: toStatus, comment: comment ?? null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Cross-module hooks (called by staffing.service inside its $transaction)
//
// These are PROGRAMMATIC status writes driven by assignment lifecycle events.
// They deliberately BYPASS the user-facing `ALLOWED_STATUS_TRANSITIONS` state
// machine (which guards interactive `changeStatus`) — the assignment lifecycle
// is the authority here. This service remains the single writer of
// `Consultant.status`; staffing never touches the consultant table directly.
// ---------------------------------------------------------------------------

/**
 * Set the consultant to ON_MISSION when one of their assignments activates.
 * Idempotent: a no-op (no write, no audit) if already ON_MISSION.
 */
export async function setConsultantOnMission(
  consultantId: string,
  actorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const consultant = await repo.findConsultantStatusTx(consultantId, tx);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }
  if (consultant.status === 'ON_MISSION') {
    return; // idempotent
  }
  await repo.updateConsultantStatusTx(consultantId, 'ON_MISSION', tx);
  await repo.writeAuditLog(
    {
      entityType: 'CONSULTANT',
      entityId: consultantId,
      action: 'STATUS_CHANGE',
      actorId,
      payload: { from: consultant.status, to: 'ON_MISSION', via: 'assignment' },
    },
    tx,
  );
}

/**
 * When an assignment ENDS: if the consultant has NO other ACTIVE assignment,
 * move them to INTERCONTRAT (the bench / idle-cost status — D3, NOT AVAILABLE).
 * No-op if they still have an ACTIVE assignment, or are already INTERCONTRAT.
 *
 * NOTE: this hook runs AFTER the ending assignment's status is already written
 * to ENDED inside the same transaction, so the ended assignment no longer
 * counts as ACTIVE — no exclusion id is required.
 *
 * @remarks Call-order invariant: this MUST be called AFTER the ending
 * assignment has been set to ENDED within the SAME `tx`. Otherwise the
 * just-ended assignment would still be counted as ACTIVE by
 * `countActiveAssignmentsTx`, and the consultant would wrongly be left
 * ON_MISSION. This is precisely why no exclude-id is passed to the count.
 * @requires the ending assignment is already ENDED in `tx`.
 */
export async function setConsultantIntercontratIfIdle(
  consultantId: string,
  actorId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const consultant = await repo.findConsultantStatusTx(consultantId, tx);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }
  if (consultant.status === 'INTERCONTRAT') {
    return; // idempotent
  }
  const activeCount = await repo.countActiveAssignmentsTx(consultantId, undefined, tx);
  if (activeCount > 0) {
    return; // still on at least one active assignment — leave status untouched
  }
  await repo.updateConsultantStatusTx(consultantId, 'INTERCONTRAT', tx);
  await repo.writeAuditLog(
    {
      entityType: 'CONSULTANT',
      entityId: consultantId,
      action: 'STATUS_CHANGE',
      actorId,
      payload: { from: consultant.status, to: 'INTERCONTRAT', via: 'assignment' },
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Documents metadata
// ---------------------------------------------------------------------------

export async function listConsultantDocuments(
  consultantId: string,
  pagination: Pagination,
): Promise<PaginatedResult<DocumentMetaItem>> {
  // Lightweight existence check (no PII fetch) just to 404 a missing consultant.
  if (!(await repo.consultantExists(consultantId))) {
    throw AppError.notFound('Consultant not found');
  }
  const { items, total } = await repo.listConsultantDocuments(consultantId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}

/**
 * Re-send the set-password invitation email to a consultant (RH/DIRECTION action)
 * — e.g. when the original invite link expired. Delegates the actual send to
 * Keycloak's execute-actions-email; writes an audit entry.
 */
export async function resendConsultantInvite(
  consultantId: string,
  actorId: string,
): Promise<void> {
  const record = await repo.findConsultantKeycloakId(consultantId);
  if (!record) {
    throw AppError.notFound('Consultant not found');
  }
  await resendInvite(record.user.keycloakId);
  await repo.writeAuditLog({
    entityType: 'CONSULTANT',
    entityId: consultantId,
    action: 'RESEND_INVITE',
    actorId,
    payload: {},
  });
}
