import { AppError } from '../../lib/app-error.js';
import { config } from '../../config/env.js';
import { applyEmailSuffix, generateBaseEmail } from '../../lib/company-email.js';
import {
  activateUser,
  checkKeycloakUsernameExists,
  deleteUser,
  provisionUser,
  resendInvite,
  setUserEnabled,
} from '../../lib/keycloak-admin.js';
import { logger } from '../../lib/logger.js';
import * as repo from './users.repository.js';
import type { CreateUserBody, ListUsersQuery, PatchUserStatusBody } from './users.schema.js';

/**
 * Users admin business logic (DIRECTION): staff-account creation with Keycloak
 * provisioning, activate/deactivate, invite resend. Mirrors the consultant
 * conversion flow: company email generated server-side (collision-suffixed),
 * account created DISABLED then enabled only after the DB write commits, with
 * Keycloak compensation on DB failure. Never creates CONSULTANT accounts —
 * those come exclusively from candidate→consultant conversion.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listUsers(query: ListUsersQuery) {
  const { items, total } = await repo.listUsers(
    {
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return { data: items, total, page: query.page, pageSize: query.pageSize };
}

export async function createStaffUser(body: CreateUserBody, actorId: string) {
  // Resolve a unique company email (prenom.nom@esn.local), suffixing on collision.
  const baseEmail = generateBaseEmail(body.firstName, body.lastName, config.COMPANY_EMAIL_DOMAIN);
  let email = baseEmail;
  for (let suffix = 2; ; suffix++) {
    const [dbConflict, kcConflict] = await Promise.all([
      repo.findUserByEmail(email),
      checkKeycloakUsernameExists(email),
    ]);
    if (!dbConflict && !kcConflict) break;
    if (suffix > 99) {
      throw AppError.internal('Could not generate a unique company email after 99 attempts');
    }
    email = applyEmailSuffix(baseEmail, suffix);
  }

  // 1. Keycloak first (disabled) — we need the `sub` for User.keycloakId.
  const { id: keycloakId } = await provisionUser({
    email,
    firstName: body.firstName,
    lastName: body.lastName,
    realmRole: body.role,
  });

  // 2. DB write; compensate by deleting the Keycloak account on failure.
  let user;
  try {
    user = await repo.createStaffUser({
      keycloakId,
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
    });
  } catch (e) {
    await deleteUser(keycloakId).catch(() => undefined);
    throw e;
  }

  // 3. Enable the account now that the domain record exists.
  try {
    await activateUser(keycloakId);
  } catch (e) {
    logger.error(
      { err: e, keycloakId, userId: user.id },
      'Staff user created but Keycloak activation failed; enable manually',
    );
  }

  await repo.writeAuditLog({
    entityType: 'USER',
    entityId: user.id,
    action: 'CREATE',
    actorId,
    payload: { role: body.role, email },
  });
  return user;
}

export async function patchUserStatus(id: string, body: PatchUserStatusBody, actorId: string) {
  if (id === actorId) {
    throw AppError.conflict('You cannot deactivate your own account', {
      code: 'CANNOT_DEACTIVATE_SELF',
    });
  }
  const user = await repo.findUserAdminById(id);
  if (!user) throw AppError.notFound('User not found');

  // Keycloak first (a failure leaves the DB flag unchanged), then the DB flag.
  await setUserEnabled(user.keycloakId, body.isActive);
  const updated = await repo.setUserActive(id, body.isActive);

  await repo.writeAuditLog({
    entityType: 'USER',
    entityId: id,
    action: body.isActive ? 'ACTIVATE' : 'DEACTIVATE',
    actorId,
    payload: {},
  });
  return updated;
}

export async function resendUserInvite(id: string, actorId: string): Promise<void> {
  const user = await repo.findUserAdminById(id);
  if (!user) throw AppError.notFound('User not found');
  await resendInvite(user.keycloakId);
  await repo.writeAuditLog({
    entityType: 'USER',
    entityId: id,
    action: 'RESEND_INVITE',
    actorId,
    payload: {},
  });
}
