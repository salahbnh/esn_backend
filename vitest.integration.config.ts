import { defineConfig } from 'vitest/config';

/**
 * Integration tests (backend/test/**). These need a running Postgres and the
 * full env (see test files' header comments). Kept separate from the default
 * unit run so `npm test` stays DB-free.
 *
 * Run: `npm run test:integration` (DB up + env provided).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
