import { z } from 'zod';
import { DocumentType, EntityType } from '@prisma/client';

/**
 * Zod schemas for the Documents module. Write bodies are `.strict()`; query
 * schemas are NOT strict. DTO types are inferred. The `DocumentMeta` response
 * shape DELIBERATELY excludes `storageKey` — it must never reach a client.
 */

export const IdParamSchema = z.object({
  id: z.string().cuid(),
});

// Non-file upload metadata (multer populates req.body for the multipart route).
export const UploadMetaSchema = z
  .object({
    type: z.nativeEnum(DocumentType),
    entityType: z.nativeEnum(EntityType),
    entityId: z.string().cuid(),
  })
  .strict();

// List — NOT `.strict()` (query strings may carry innocuous extra keys).
export const ListDocumentsQuerySchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().cuid(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type IdParam = z.infer<typeof IdParamSchema>;
export type UploadMeta = z.infer<typeof UploadMetaSchema>;
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

/** Response shape — NO `storageKey`. */
export interface DocumentMeta {
  id: string;
  type: DocumentType;
  entityType: EntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: string;
}
