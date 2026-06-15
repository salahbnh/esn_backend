import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../lib/app-error.js';

/**
 * Role gate. Declare allowed roles per route — authorization is decided here,
 * on the server, never in the controller body or the UI.
 */
export function rbac(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden('Insufficient role');
    }
    next();
  };
}

/**
 * Resolves the userId that owns the resource targeted by the request.
 * Returns the owning User.id, or null if it cannot be resolved.
 */
export type OwnershipResolver = (req: Request) => Promise<string | null> | string | null;

/**
 * Ownership gate for the 🟡 (own-records-only) rows in docs/rbac-matrix.md.
 *
 * Compose AFTER `auth` and (optionally) `rbac`. The resolver returns the
 * owning User.id for the targeted resource; access is denied on mismatch.
 *
 * TODO: provide per-resource resolvers in each module, e.g.
 *   - consultant profile: Consultant.userId for the :id param
 *   - mission visibility: any Assignment.consultant.userId === req.user.id
 *   - document download: Document.entityId -> owning consultant's userId
 * Never trust an id taken from the request body — resolve from the DB.
 */
export function requireOwnership(resolver: OwnershipResolver): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      if (!req.user) {
        throw AppError.unauthorized();
      }
      const ownerId = await resolver(req);
      if (!ownerId || ownerId !== req.user.id) {
        throw AppError.forbidden('Not the owner of this resource');
      }
      next();
    })().catch(next);
  };
}
