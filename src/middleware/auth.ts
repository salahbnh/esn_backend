import type { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { verifyToken, type KeycloakClaims } from '../lib/keycloak.js';
import { AppError } from '../lib/app-error.js';
import { config } from '../config/env.js';
import { asyncHandler } from './async-handler.js';
import {
  findAuthUserByKeycloakId,
  provisionAuthUser,
  updateAuthUserRole,
} from '../modules/users/users.repository.js';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Resolve the single application role from the verified token. Gathers every
 * recognized app-Role present across realm and the configured client's resource
 * roles. The mapping must be UNAMBIGUOUS: exactly one recognized role -> use it;
 * zero or more-than-one -> reject (no "first match wins").
 */
function resolveRole(claims: KeycloakClaims): Role {
  const realmRoles = claims.realm_access?.roles ?? [];
  const clientRoles = claims.resource_access?.[config.KEYCLOAK_AUDIENCE]?.roles ?? [];

  const recognized = new Set<Role>();
  for (const raw of [...realmRoles, ...clientRoles]) {
    const upper = raw.toUpperCase();
    if (VALID_ROLES.has(upper)) {
      recognized.add(upper as Role);
    }
  }

  if (recognized.size !== 1) {
    throw AppError.forbidden('Token has no single recognized application role');
  }
  return [...recognized][0] as Role;
}

/**
 * Auth middleware: extract Bearer token, verify it, attach req.user.
 * Maps token `sub` -> User.keycloakId. JIT-provisions a User row on first
 * contact. Identity + role are trusted ONLY from the verified token.
 */
export const auth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing Bearer token');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw AppError.unauthorized('Empty Bearer token');
  }

  const claims = await verifyToken(token);
  if (!claims.sub) {
    // Keycloak 26 serves `sub` via the "basic" client scope — if it's absent the
    // client is misconfigured. Fail clearly rather than with a downstream DB error.
    throw AppError.unauthorized('Token has no subject (sub) claim');
  }
  const role = resolveRole(claims);

  let user = await findAuthUserByKeycloakId(claims.sub);

  if (!user) {
    // JIT provisioning. Materialize the User row from trusted token claims so
    // audit actors and interaction/evaluation authorship reference a real User.
    if (!claims.email) {
      throw AppError.forbidden('Token has no email claim; cannot provision user');
    }
    if (claims.email_verified !== true) {
      throw AppError.forbidden('Email not verified');
    }
    user = await provisionAuthUser({
      keycloakId: claims.sub,
      email: claims.email,
      firstName: claims.given_name ?? claims.preferred_username ?? 'Unknown',
      lastName: claims.family_name ?? '',
      role,
    });
  } else if (user.role !== role) {
    // The verified token is authoritative on role. Reconcile the stored row,
    // writing ONLY when it actually differs (not on every request).
    user = await updateAuthUserRole(user.id, role);
  }

  if (!user.isActive) {
    throw AppError.forbidden('User account is inactive');
  }

  req.user = {
    id: user.id,
    role: user.role,
    keycloakId: claims.sub,
  };

  next();
});
