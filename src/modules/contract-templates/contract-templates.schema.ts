import { z } from 'zod';

/**
 * Zod schemas for the Contract Templates sub-module. Write bodies are
 * `.strict()` (unknown fields rejected); the GET query schema is NOT strict.
 * DTO types are inferred — no parallel interfaces.
 */

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

export const CreateTemplateBodySchema = z
  .object({
    name: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const UpdateTemplateBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
  })
  .strict();

// List — NOT `.strict()` (query strings may carry innocuous extra keys).
export const ListTemplatesQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type IdParam = z.infer<typeof IdParamSchema>;
export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>;
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateBodySchema>;
export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
