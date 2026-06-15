import { PrismaClient } from '@prisma/client';

/**
 * Singleton PrismaClient. The ONLY place the client is instantiated.
 * Repositories import this; nothing else in the app should.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
