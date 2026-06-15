import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Users data-access layer. The ONLY place these auth-time user reads/writes
 * touch the Prisma client — the auth middleware delegates here so it never
 * imports the client directly (strict layering).
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
