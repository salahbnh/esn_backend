import type { Role, ValidationStep } from '@prisma/client';

/**
 * Shared validation-workflow constants for the Contracts module. Imported by BOTH
 * the service and the repository so the RH → MANAGER → DIRECTION order has a
 * single source of truth. Plain exports — `vi.mock` on the repository does not
 * affect these.
 */

// Ordered validation steps — RH → MANAGER → DIRECTION. The order is the
// authority for both creation and ordering enforcement.
export const VALIDATION_STEPS = ['RH', 'MANAGER', 'DIRECTION'] as const satisfies readonly ValidationStep[];

/**
 * Step → required actor role. The route-level rbac lets RH/MANAGER/DIRECTION
 * through; the service finishes authorization by matching the requester's role
 * to the CURRENT pending step's required role.
 */
export const STEP_ROLE_MAP: Record<ValidationStep, Role> = {
  RH: 'RH',
  MANAGER: 'MANAGER',
  DIRECTION: 'DIRECTION',
};
