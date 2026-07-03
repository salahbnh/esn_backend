import { z } from 'zod';

/**
 * Zod schemas for the Skills referential module. Write bodies are `.strict()`
 * (unknown fields rejected). GET query schemas are NOT strict. DTO types are
 * inferred — no parallel interfaces.
 */

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

export const CreateSkillBodySchema = z
  .object({
    name: z.string().min(1).max(100),
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

// All fields optional for a partial update; `.strict()` rejects unknown fields.
export const UpdateSkillBodySchema = CreateSkillBodySchema.partial().strict();

// List — NOT `.strict()` (query strings may carry innocuous extra keys). A skills
// referential is small; pageSize caps at 200 so the picker fetches all at once.
export const ListSkillsQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type IdParam = z.infer<typeof IdParamSchema>;
export type CreateSkillBody = z.infer<typeof CreateSkillBodySchema>;
export type UpdateSkillBody = z.infer<typeof UpdateSkillBodySchema>;
export type ListSkillsQuery = z.infer<typeof ListSkillsQuerySchema>;
