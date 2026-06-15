import { z } from 'zod';
import { ConsultantStatus } from '@prisma/client';

/**
 * Zod schemas for the Consultants module. All write bodies are `.strict()`
 * (unknown fields rejected). DTO types are inferred — no parallel interfaces.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const IdParamSchema = z
  .object({
    id: z.string().cuid(),
  })
  .strict();

// GET query schemas are NOT `.strict()` — query strings may carry innocuous
// extra keys (matching the recruitment query-schema convention). Write BODY
// schemas stay strict.
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const ListConsultantsQuerySchema = z.object({
  status: z.nativeEnum(ConsultantStatus).optional(),
  skillId: z.string().cuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Admin profile update (§3.4) — HR-authored fields included
// ---------------------------------------------------------------------------

export const UpdateConsultantBodySchema = z
  .object({
    position: z.string().min(1).optional(),
    tjm: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
    seniority: z.string().optional(),
    bio: z.string().optional(),
    availabilityDate: z.string().datetime().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Self-edit (§3.3 PATCH /me) — intentionally narrow; NO position/tjm/status/
// availabilityDate. `.strict()` rejects any administrative field.
// ---------------------------------------------------------------------------

export const UpdateOwnProfileBodySchema = z
  .object({
    bio: z.string().optional(),
    seniority: z.string().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Status change (§3.5)
// ---------------------------------------------------------------------------

export const StatusChangeBodySchema = z
  .object({
    status: z.nativeEnum(ConsultantStatus),
    comment: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type IdParam = z.infer<typeof IdParamSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type ListConsultantsQuery = z.infer<typeof ListConsultantsQuerySchema>;
export type UpdateConsultantBody = z.infer<typeof UpdateConsultantBodySchema>;
export type UpdateOwnProfileBody = z.infer<typeof UpdateOwnProfileBodySchema>;
export type StatusChangeBody = z.infer<typeof StatusChangeBodySchema>;
