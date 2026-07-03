import { z } from 'zod';

/**
 * Zod schemas for the PUBLIC apply endpoint. Fields arrive as multipart form
 * strings (parsed by multer); JSON-encoded fields are parsed + shape-checked
 * here, then answers are validated dynamically against the job's live questions.
 */

export const TokenParamSchema = z.object({
  token: z.string().min(10).max(64),
});

function jsonRecord() {
  return z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string(), z.unknown()));
}

function jsonStringArray() {
  return z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.string().max(100)).max(30));
}

export const PublicApplyBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().max(32).optional(),
    consentAccepted: z.enum(['true', 'false']).transform((v) => v === 'true'),
    answers: jsonRecord().optional().default('{}'),
    declaredSkillNames: jsonStringArray().optional().default('[]'),
    // Honeypot — bots fill hidden fields. Handled silently in the service.
    hp_website: z.string().optional(),
    // Turnstile token — only verified when TURNSTILE_SECRET is configured.
    cfTurnstileResponse: z.string().max(4096).optional(),
  })
  .strip(); // multipart may carry file-part metadata keys; strip rather than reject

export type PublicApplyBody = z.infer<typeof PublicApplyBodySchema>;
