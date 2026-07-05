import type { EntityType, Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Users data-access layer: the auth-time reads (JIT provisioning) AND the
 * DIRECTION users-admin queries. The only users-module file importing Prisma.
 */

export interface AuthUser {
  id: string;
  role: Role;
  isActive: boolean;
}

export interface ProvisionAuthUserInput {
  keycloakId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export function findAuthUserByKeycloakId(sub: string): Promise<AuthUser | null> {
  return prisma.user.findUnique({
    where: { keycloakId: sub },
    select: { id: true, role: true, isActive: true },
  });
}

/**
 * Race-safe JIT provisioning: `upsert` keyed on keycloakId, create-only (no
 * update). Concurrent first requests for the same subject converge on one row.
 */
export function provisionAuthUser(input: ProvisionAuthUserInput): Promise<AuthUser> {
  return prisma.user.upsert({
    where: { keycloakId: input.keycloakId },
    update: {},
    create: {
      keycloakId: input.keycloakId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
    },
    select: { id: true, role: true, isActive: true },
  });
}

export function updateAuthUserRole(id: string, role: Role): Promise<AuthUser> {
  return prisma.user.update({
    where: { id },
    data: { role },
    select: { id: true, role: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Users admin (DIRECTION) — list / create / status
// ---------------------------------------------------------------------------

/** Public projection — NEVER exposes keycloakId to the client. */
const USER_ADMIN_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

export interface Pagination {
  page: number;
  pageSize: number;
}

export async function listUsers(
  filter: { role?: Role; search?: string },
  { page, pageSize }: Pagination,
) {
  const where: Prisma.UserWhereInput = {};
  if (filter.role) where.role = filter.role;
  if (filter.search) {
    where.OR = [
      { firstName: { contains: filter.search, mode: 'insensitive' } },
      { lastName: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      select: USER_ADMIN_SELECT,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total };
}

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

export function findUserAdminById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { ...USER_ADMIN_SELECT, keycloakId: true },
  });
}

export interface CreateStaffUserData {
  keycloakId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export function createStaffUser(data: CreateStaffUserData) {
  return prisma.user.create({ data, select: USER_ADMIN_SELECT });
}

export function setUserActive(id: string, isActive: boolean) {
  return prisma.user.update({ where: { id }, data: { isActive }, select: USER_ADMIN_SELECT });
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

export function writeAuditLog(entry: AuditLogData): Promise<unknown> {
  return prisma.auditLog.create({ data: entry });
}
