import type { Role } from '@prisma/client';

/**
 * Authenticated principal attached by the auth middleware.
 * `id` is the local User.id — always set (the auth middleware JIT-provisions
 * a User row from the verified token if one does not yet exist).
 */
export interface AuthUser {
  id: string;
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
