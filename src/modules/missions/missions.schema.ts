import { z } from 'zod';
import { MissionStatus } from '@prisma/client';

/**
 * Zod schemas for the Missions module. All write bodies are `.strict()` (unknown
 * fields rejected). GET query schemas are NOT strict. DTO types are inferred —
 * no parallel interfaces. Money (tjm) is a string-decimal (Decimal column).
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

const tjm = z.string().regex(/^\d+(\.\d{1,2})?$/);

// ---------------------------------------------------------------------------
// Create / Update
// ---------------------------------------------------------------------------

export const CreateMissionBodySchema = z
  .object({
    clientId: z.string().cuid(),
    project: z.string().min(1),
    role: z.string().min(1),
    description: z.string().optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    tjm,
    requiredSkillIds: z.array(z.string().cuid()).default([]),
  })
  .strict();

export const UpdateMissionBodySchema = z
  .object({
    clientId: z.string().cuid().optional(),
    project: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    description: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    tjm: tjm.optional(),
    requiredSkillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Status transition — ARCHIVED is rejected here (use the dedicated /archive endpoint)
// ---------------------------------------------------------------------------

export const MissionStatusTransitionBodySchema = z
  .object({
    status: z.nativeEnum(MissionStatus).refine((s) => s !== MissionStatus.ARCHIVED, {
      message: 'Use the /archive endpoint to archive a mission',
    }),
    comment: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

/**
 * `changes` is a free-form before/after delta object (mirrors the `changes Json`
 * column). Structure is application-convention, not DB-enforced.
 */
export const CreateAmendmentBodySchema = z
  .object({
    reason: z.string().min(1),
    changes: z.record(z.unknown()),
    effectiveDate: z.string().datetime(),
  })
  .strict();

// ---------------------------------------------------------------------------
// List — NOT `.strict()` (query strings may carry innocuous extra keys)
// ---------------------------------------------------------------------------

export const ListMissionsQuerySchema = z.object({
  status: z.nativeEnum(MissionStatus).optional(),
  clientId: z.string().cuid().optional(),
  skillId: z.string().cuid().optional(),
  search: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type IdParam = z.infer<typeof IdParamSchema>;
export type CreateMissionBody = z.infer<typeof CreateMissionBodySchema>;
export type UpdateMissionBody = z.infer<typeof UpdateMissionBodySchema>;
export type MissionStatusTransitionBody = z.infer<typeof MissionStatusTransitionBodySchema>;
export type CreateAmendmentBody = z.infer<typeof CreateAmendmentBodySchema>;
export type ListMissionsQuery = z.infer<typeof ListMissionsQuerySchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
