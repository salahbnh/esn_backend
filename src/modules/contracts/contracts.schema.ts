import { z } from 'zod';
import { ContractStatus } from '@prisma/client';

/**
 * Zod schemas for the Contracts module. All write bodies are `.strict()` (unknown
 * fields rejected). GET query schemas are NOT strict. DTO types are inferred —
 * no parallel interfaces. Dates are ISO-8601 strings.
 */

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

export const CreateContractBodySchema = z
  .object({
    consultantId: z.string().cuid(),
    templateId: z.string().cuid().optional(),
    type: z.string().min(1),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    // RH-entered manual placeholder values (placeholder name -> value).
    fields: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

export const UpdateContractBodySchema = z
  .object({
    type: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    // RH-entered manual placeholder values (placeholder name -> value).
    fields: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

export const ValidateStepBodySchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().optional(),
  })
  .strict();

// Two-party signing. Consultant-sign and countersign carry no body (the actor is
// the verified user; the signatory name is resolved server-side from the DB).
export const ConsultantSignBodySchema = z.object({}).strict();
export const CountersignBodySchema = z.object({}).strict();
export const RejectContractBodySchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const CreateAmendmentBodySchema = z
  .object({
    reason: z.string().min(1),
    changes: z.record(z.unknown()),
    effectiveDate: z.string().datetime(),
  })
  .strict();

// List — NOT `.strict()` (query strings may carry innocuous extra keys).
export const ListContractsQuerySchema = z.object({
  status: z.nativeEnum(ContractStatus).optional(),
  consultantId: z.string().cuid().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type IdParam = z.infer<typeof IdParamSchema>;
export type CreateContractBody = z.infer<typeof CreateContractBodySchema>;
export type UpdateContractBody = z.infer<typeof UpdateContractBodySchema>;
export type ValidateStepBody = z.infer<typeof ValidateStepBodySchema>;
export type RejectContractBody = z.infer<typeof RejectContractBodySchema>;
export type CreateAmendmentBody = z.infer<typeof CreateAmendmentBodySchema>;
export type ListContractsQuery = z.infer<typeof ListContractsQuerySchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
