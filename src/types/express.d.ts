import type { Role } from '@prisma/client';

/**
 * Authenticated principal attached by the auth middleware.
 * `id` is the local User.id (null if the verified subject has no User row yet).
 */
export interface AuthUser {
  id: string | null;
  role: Role;
  keycloakId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
