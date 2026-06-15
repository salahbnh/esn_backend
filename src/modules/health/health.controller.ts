import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';

/**
 * Liveness/readiness probe. Pings the DB and reports overall status.
 * Public (unauthenticated) so infra can monitor without a token.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db });
}
