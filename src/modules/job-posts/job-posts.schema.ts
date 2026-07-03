import { z } from 'zod';
import {
  ApplicationStatus,
  EmploymentType,
  JobPostStatus,
  QuestionType,
  SeniorityLevel,
} from '@prisma/client';

/**
 * Zod schemas for the Job Posts admin module (authenticated). Write bodies are
 * `.strict()`. GET query schemas are not strict. DTO types are inferred.
 */

export const IdParamSchema = z.object({ id: z.string().cuid() });
export const QuestionParamSchema = z.object({
  id: z.string().cuid(),
  qid: z.string().cuid(),
});

const ConfigSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

export const CreateJobPostBodySchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    requirements: z.string().optional(),
    location: z.string().max(100).optional(),
    employmentType: z.nativeEnum(EmploymentType),
    seniorityLevel: z.nativeEnum(SeniorityLevel).optional(),
    minYearsExperience: z.number().int().min(0).max(40).optional(),
    expiresAt: z.string().datetime().optional(),
    skillIds: z.array(z.string().cuid()).optional(),
  })
  .strict();

export const UpdateJobPostBodySchema = CreateJobPostBodySchema.partial().strict();

export const CreateQuestionBodySchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,50}$/, 'lowercase letters, digits, underscore'),
    label: z.string().min(1).max(200),
    type: z.nativeEnum(QuestionType),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(100)).min(2).optional(),
    config: ConfigSchema.optional(),
    helpText: z.string().max(500).optional(),
  })
  .strict();

export const UpdateQuestionBodySchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(100)).min(2).optional(),
    config: ConfigSchema.optional(),
    helpText: z.string().max(500).optional(),
  })
  .strict();

export const ReorderQuestionsBodySchema = z
  .object({ orderedIds: z.array(z.string().cuid()).min(1) })
  .strict();

export const PatchApplicationStatusBodySchema = z
  .object({
    status: z.enum(['UNDER_REVIEW', 'REJECTED', 'SPAM']),
    rejectionReason: z.string().max(1000).optional(),
  })
  .strict();

export const LinkApplicationBodySchema = z
  .object({
    targetPosition: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const ListJobPostsQuerySchema = z.object({
  status: z.nativeEnum(JobPostStatus).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ListApplicationsQuerySchema = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateJobPostBody = z.infer<typeof CreateJobPostBodySchema>;
export type UpdateJobPostBody = z.infer<typeof UpdateJobPostBodySchema>;
export type CreateQuestionBody = z.infer<typeof CreateQuestionBodySchema>;
export type UpdateQuestionBody = z.infer<typeof UpdateQuestionBodySchema>;
export type ReorderQuestionsBody = z.infer<typeof ReorderQuestionsBodySchema>;
export type PatchApplicationStatusBody = z.infer<typeof PatchApplicationStatusBodySchema>;
export type LinkApplicationBody = z.infer<typeof LinkApplicationBodySchema>;
export type ListJobPostsQuery = z.infer<typeof ListJobPostsQuerySchema>;
export type ListApplicationsQuery = z.infer<typeof ListApplicationsQuerySchema>;
