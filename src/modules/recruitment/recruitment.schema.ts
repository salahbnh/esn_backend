import { z } from 'zod';
import { CandidateStatus } from '@prisma/client';

/**
 * Zod schemas for the Recruitment (ATS) module. All write bodies are `.strict()`
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

export const ProposalParamsSchema = z
  .object({
    id: z.string().cuid(),
    proposalId: z.string().cuid(),
  })
  .strict();

export const PaginationQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Candidate CRUD
// ---------------------------------------------------------------------------

export const CreateCandidateBodySchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    source: z.string().optional(),
    targetPosition: z.string().optional(),
    notes: z.string().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

export const UpdateCandidateBodySchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    source: z.string().optional(),
    targetPosition: z.string().optional(),
    notes: z.string().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

export const ListCandidatesQuerySchema = z
  .object({
    status: z.nativeEnum(CandidateStatus).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pipeline status transition
// ---------------------------------------------------------------------------

export const StatusTransitionBodySchema = z
  .object({
    status: z
      .nativeEnum(CandidateStatus)
      .refine((s) => s !== 'HIRED', {
        message: 'Use the convert endpoint to hire a candidate',
      }),
    comment: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export const CreateInteractionBodySchema = z
  .object({
    type: z.enum(['CALL', 'EMAIL', 'INTERVIEW', 'NOTE']),
    occurredAt: z.string().datetime(),
    summary: z.string().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export const CreateEvaluationBodySchema = z
  .object({
    criteria: z.record(z.string(), z.number().int().min(0).max(10)),
    overallScore: z.number().int().min(0).max(10),
    recommendation: z.string().optional(),
    comment: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export const CreateProposalBodySchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
  })
  .strict();

export const UpdateProposalStatusBodySchema = z
  .object({
    status: z.enum(['SENT', 'ACCEPTED', 'DECLINED']),
  })
  .strict();

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export const ConvertCandidateBodySchema = z
  .object({
    // No userId — the Keycloak account is auto-provisioned from the candidate's
    // email/firstName/lastName (plan §0). Body carries only Consultant fields.
    position: z.string().min(1),
    hireDate: z.string().datetime().optional(),
    tjm: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
    seniority: z.string().optional(),
    bio: z.string().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type IdParam = z.infer<typeof IdParamSchema>;
export type ProposalParams = z.infer<typeof ProposalParamsSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type CreateCandidateBody = z.infer<typeof CreateCandidateBodySchema>;
export type UpdateCandidateBody = z.infer<typeof UpdateCandidateBodySchema>;
export type ListCandidatesQuery = z.infer<typeof ListCandidatesQuerySchema>;
export type StatusTransitionBody = z.infer<typeof StatusTransitionBodySchema>;
export type CreateInteractionBody = z.infer<typeof CreateInteractionBodySchema>;
export type CreateEvaluationBody = z.infer<typeof CreateEvaluationBodySchema>;
export type CreateProposalBody = z.infer<typeof CreateProposalBodySchema>;
export type UpdateProposalStatusBody = z.infer<typeof UpdateProposalStatusBodySchema>;
export type ConvertCandidateBody = z.infer<typeof ConvertCandidateBodySchema>;
