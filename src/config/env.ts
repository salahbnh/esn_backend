import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of validated configuration. Read env ONLY through this module.
 * The process crashes at boot if any required variable is missing/invalid.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGIN: z.string().url(),

  DATABASE_URL: z.string().url(),

  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    'Invalid environment configuration:',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

export type Config = z.infer<typeof envSchema>;

export const config: Config = parsed.data;
