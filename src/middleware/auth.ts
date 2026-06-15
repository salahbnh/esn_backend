import type { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyToken, type KeycloakClaims } from '../lib/keycloak.js';
import { AppError } from '../lib/app-error.js';
import { config } from '../config/env.js';
import { asyncHandler } from './async-handler.js';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Map verified Keycloak role claims to our app Role. We only trust roles from
 * the verified token. Realm roles take precedence; falls back to the
 * configured client's resource_access roles.
 */
function resolveRole(claims: KeycloakClaims): Role | null {
  const realmRoles = claims.realm_access?.roles ?? [];
  const clientRoles = claims.resource_access?.[config.KEYCLOAK_AUDIENCE]?.roles ?? [];
  const candidates = [...realmRoles, ...clientRoles];
  for (const raw of candidates) {
    const upper = raw.toUpperCase();
    if (VALID_ROLES.has(upper)) {
      return upper as Role;
    }
  }
  return null;
}

/**
 * Auth middleware: extract Bearer token, verify it, attach req.user.
 * Maps token `sub` -> User.keycloakId. For the skeleton, if no User row
 * exists yet, we still attach the claims-derived role (id = null).
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

  const role = resolveRole(claims);
  if (!role) {
    throw AppError.forbidden('Token has no recognized application role');
  }

  const user = await prisma.user.findUnique({
    where: { keycloakId: claims.sub },
    select: { id: true, role: true, isActive: true },
  });

  if (user && !user.isActive) {
    throw AppError.forbidden('User account is inactive');
  }

  req.user = {
    // Trust the DB role when the user exists; otherwise use the token role.
    id: user?.id ?? null,
    role: user?.role ?? role,
    keycloakId: claims.sub,
  };

  next();
});
