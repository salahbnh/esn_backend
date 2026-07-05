import { z } from 'zod';


/**
 * Zod schemas for the Users admin module (staff account management). Write
 * bodies are `.strict()`. Only STAFF roles are creatable here — CONSULTANT
 * accounts come exclusively from candidate→consultant conversion.
 */

export const IdParamSchema = z.object({ id: z.string().cuid() });

export const STAFF_ROLES = ['RH', 'MANAGER', 'DIRECTION'] as const;

export const CreateUserBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: z.enum(STAFF_ROLES),
  })
  .strict();

export const PatchUserStatusBodySchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

// NOT strict (query strings may carry innocuous extra keys). The role filter is
// limited to STAFF roles — this is a staff directory, not a consultant browser.
export const ListUsersQuerySchema = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;
export type PatchUserStatusBody = z.infer<typeof PatchUserStatusBodySchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
