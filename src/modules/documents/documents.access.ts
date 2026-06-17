import type { DocumentType, EntityType, Role } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './documents.repository.js';

/** Minimal authenticated principal needed for authorization decisions. */
export interface AccessUser {
  id: string;
  role: Role;
}

/**
 * SECURITY CORE — the per-(entityType, action) authorization matrix plus
 * DB-resolved ownership for CONSULTANT. NO Prisma import here: every ownership
 * lookup goes through the repository resolvers (read-only, never trusts a body id).
 *
 * IDOR chokepoint: download/list/delete resolve the entity from the Document row
 * (or validated query), then run the matrix + ownership check before anything
 * sensitive (presigned URL, soft-delete) happens.
 */

export interface DocRef {
  entityType: EntityType;
  entityId: string;
}

// Roles allowed to UPLOAD per entityType. CONSULTANT presence is further gated
// in assertCanUpload (own CONSULTANT entity + CV/OTHER only).
const UPLOAD_MATRIX: Record<EntityType, Role[]> = {
  CANDIDATE: ['RH', 'DIRECTION'],
  CONSULTANT: ['RH', 'DIRECTION', 'CONSULTANT'],
  CONTRACT: ['RH', 'DIRECTION'],
  CONTRACT_TEMPLATE: ['RH', 'DIRECTION'],
  MISSION: ['MANAGER', 'DIRECTION'],
  ASSIGNMENT: ['MANAGER', 'DIRECTION'],
  CLIENT: ['RH', 'MANAGER', 'DIRECTION'],
};

// DocumentTypes a CONSULTANT may upload to their own CONSULTANT entity.
const CONSULTANT_SELF_UPLOAD_TYPES: DocumentType[] = ['CV', 'OTHER'];

// Roles allowed to DOWNLOAD/LIST per entityType. CONSULTANT presence is further
// gated in assertCanDownload (per-type ownership).
const DOWNLOAD_MATRIX: Record<EntityType, Role[]> = {
  CANDIDATE: ['RH', 'DIRECTION', 'MANAGER'],
  CONSULTANT: ['RH', 'DIRECTION', 'MANAGER', 'CONSULTANT'],
  CONTRACT: ['RH', 'DIRECTION', 'MANAGER', 'CONSULTANT'],
  CONTRACT_TEMPLATE: ['RH', 'DIRECTION'],
  MISSION: ['RH', 'DIRECTION', 'MANAGER', 'CONSULTANT'],
  ASSIGNMENT: ['RH', 'DIRECTION', 'MANAGER', 'CONSULTANT'],
  CLIENT: ['RH', 'DIRECTION', 'MANAGER'],
};

/**
 * Upload authorization. Throws 403 on role/ownership denial. Does NOT check
 * entity existence (the service does that next, returning 404).
 */
export async function assertCanUpload(
  user: AccessUser,
  entityType: EntityType,
  entityId: string,
  docType: DocumentType,
): Promise<void> {
  const allowed = UPLOAD_MATRIX[entityType];
  if (!allowed.includes(user.role)) {
    throw AppError.forbidden('Not allowed to upload to this entity');
  }

  if (user.role === 'CONSULTANT') {
    // A CONSULTANT may only upload their OWN CV/OTHER to their OWN profile.
    if (entityType !== 'CONSULTANT' || !CONSULTANT_SELF_UPLOAD_TYPES.includes(docType)) {
      throw AppError.forbidden(
        'Consultants may only upload CV or OTHER documents to their own profile',
      );
    }
    const ownerUserId = await repo.resolveConsultantOwnerUserId(entityId);
    if (ownerUserId !== user.id) {
      throw AppError.forbidden('Not the owner of this consultant profile');
    }
  }
}

/**
 * Download/list authorization. Throws 403 on role/ownership denial. The caller
 * passes the entity resolved from the Document row (download) or the validated
 * query (list) — never a body-supplied id.
 */
export async function assertCanDownload(user: AccessUser, ref: DocRef): Promise<void> {
  const allowed = DOWNLOAD_MATRIX[ref.entityType];
  if (!allowed.includes(user.role)) {
    throw AppError.forbidden('Not allowed to access this document');
  }

  if (user.role === 'CONSULTANT') {
    await assertConsultantOwnsRef(user, ref);
  }
}

async function assertConsultantOwnsRef(user: AccessUser, ref: DocRef): Promise<void> {
  switch (ref.entityType) {
    case 'CONSULTANT': {
      const ownerUserId = await repo.resolveConsultantOwnerUserId(ref.entityId);
      if (ownerUserId !== user.id) throw AppError.forbidden('Not the owner of this document');
      return;
    }
    case 'CONTRACT': {
      const ownerUserId = await repo.resolveContractOwnerUserId(ref.entityId);
      if (ownerUserId !== user.id) throw AppError.forbidden('Not the owner of this document');
      return;
    }
    case 'ASSIGNMENT': {
      const ownerUserId = await repo.resolveAssignmentOwnerUserId(ref.entityId);
      if (ownerUserId !== user.id) throw AppError.forbidden('Not the owner of this document');
      return;
    }
    case 'MISSION': {
      const consultantId = await repo.findConsultantIdByUserId(user.id);
      if (!consultantId) throw AppError.forbidden('Not assigned to this mission');
      const assigned = await repo.consultantHasMissionAssignment(consultantId, ref.entityId);
      if (!assigned) throw AppError.forbidden('Not assigned to this mission');
      return;
    }
    default:
      // CANDIDATE, CLIENT, CONTRACT_TEMPLATE — never CONSULTANT-accessible.
      throw AppError.forbidden('Not allowed to access this document');
  }
}

/**
 * Delete/restore authorization: RH and DIRECTION only — no ownership exception.
 * `_ref` is accepted for call-site symmetry with the download/upload asserts;
 * delete is role-gated only and never consults the entity ref.
 */
export function assertCanDelete(user: AccessUser, _ref: DocRef): void {
  if (user.role !== 'RH' && user.role !== 'DIRECTION') {
    throw AppError.forbidden('Not allowed to delete documents');
  }
}
