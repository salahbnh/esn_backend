import { z } from 'zod';
import { AssignmentStatus } from '@prisma/client';

/**
 * Zod schemas for the Staffing / Affectation module. All write bodies are
 * `.strict()` (unknown fields rejected). GET query schemas are NOT strict
 * (query strings may carry innocuous extra keys). DTO types are inferred — no
 * parallel interfaces.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

export const ConsultantIdParamSchema = z.object({
  consultantId: z.string().cuid(),
});

const allocationPct = z.coerce.number().int().min(1).max(100);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateAssignmentBodySchema = z
  .object({
    missionId: z.string().cuid(),
    consultantId: z.string().cuid(),
    roleOnMission: z.string().min(1).optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    allocationPct: allocationPct.default(100),
  })
  .strict()
  .refine(
    (b) => b.endDate === undefined || new Date(b.endDate) > new Date(b.startDate),
    { message: 'endDate must be after startDate', path: ['endDate'] },
  );

// ---------------------------------------------------------------------------
// Update — mutable fields only (NEVER status; use the /status endpoint)
// ---------------------------------------------------------------------------

export const UpdateAssignmentBodySchema = z
  .object({
    roleOnMission: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    allocationPct: allocationPct.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.startDate === undefined ||
      b.endDate === undefined ||
      new Date(b.endDate) > new Date(b.startDate),
    { message: 'endDate must be after startDate', path: ['endDate'] },
  );

// ---------------------------------------------------------------------------
// Status transition
// ---------------------------------------------------------------------------

export const AssignmentStatusTransitionBodySchema = z
  .object({
    status: z.nativeEnum(AssignmentStatus),
    comment: z.string().optional(),
    force: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// List / occupancy / suggestions queries — NOT `.strict()`
// ---------------------------------------------------------------------------

export const ListAssignmentsQuerySchema = z.object({
  missionId: z.string().cuid().optional(),
  consultantId: z.string().cuid().optional(),
  status: z.nativeEnum(AssignmentStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const OwnAssignmentsQuerySchema = z.object({
  status: z.nativeEnum(AssignmentStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Global occupancy list — pagination only; the per-consultant view is a
// separate route-gated endpoint keyed by the `:consultantId` path param.
export const OccupancyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const SuggestionsQuerySchema = z.object({
  missionId: z.string().cuid(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type IdParam = z.infer<typeof IdParamSchema>;
export type ConsultantIdParam = z.infer<typeof ConsultantIdParamSchema>;
export type CreateAssignmentBody = z.infer<typeof CreateAssignmentBodySchema>;
export type UpdateAssignmentBody = z.infer<typeof UpdateAssignmentBodySchema>;
export type AssignmentStatusTransitionBody = z.infer<
  typeof AssignmentStatusTransitionBodySchema
>;
export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;
export type OwnAssignmentsQuery = z.infer<typeof OwnAssignmentsQuerySchema>;
export type OccupancyQuery = z.infer<typeof OccupancyQuerySchema>;
export type SuggestionsQuery = z.infer<typeof SuggestionsQuerySchema>;
