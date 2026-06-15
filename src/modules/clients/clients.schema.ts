import { z } from 'zod';

/**
 * Zod schemas for the Clients module. All write bodies are `.strict()` (unknown
 * fields rejected). GET query schemas are NOT strict. DTO types are inferred —
 * no parallel interfaces.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

// ---------------------------------------------------------------------------
// Create / Update
// ---------------------------------------------------------------------------

export const CreateClientBodySchema = z
  .object({
    name: z.string().min(1),
    industry: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().email().optional(),
  })
  .strict();

// All fields optional for a partial update; `.strict()` rejects unknown fields.
export const UpdateClientBodySchema = CreateClientBodySchema.partial().strict();

// ---------------------------------------------------------------------------
// List — NOT `.strict()` (query strings may carry innocuous extra keys)
// ---------------------------------------------------------------------------

export const ListClientsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type IdParam = z.infer<typeof IdParamSchema>;
export type CreateClientBody = z.infer<typeof CreateClientBodySchema>;
export type UpdateClientBody = z.infer<typeof UpdateClientBodySchema>;
export type ListClientsQuery = z.infer<typeof ListClientsQuerySchema>;
