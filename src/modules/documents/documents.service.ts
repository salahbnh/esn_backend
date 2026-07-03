import type { DocumentType } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import { buildStorageKey, getPresignedGetUrl, putObject } from '../../lib/storage.js';
import * as access from './documents.access.js';
import type { AccessUser } from './documents.access.js';
import * as repo from './documents.repository.js';
import type { Pagination } from './documents.repository.js';
import type { DocumentMeta, ListDocumentsQuery, UploadMeta } from './documents.schema.js';

/**
 * Documents business logic. Validates mime/size, runs the access matrix, talks to
 * MinIO via lib/storage, writes the DB row + AuditLog. NEVER imports the Prisma
 * client (the repository owns all DB access) and NEVER returns `storageKey`.
 */

export const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const URL_EXPIRY_SEC = 300; // 5 minutes — short presigned-GET window.

const PDF = 'application/pdf';
const DOC = 'application/msword';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLS = 'application/vnd.ms-excel';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PNG = 'image/png';
const JPEG = 'image/jpeg';

const MIME_ALLOWLIST: Record<DocumentType, string[]> = {
  CV: [PDF, DOC, DOCX],
  CONTRACT: [PDF],
  CONTRACT_AMENDMENT: [PDF],
  PROPOSAL: [PDF],
  MISSION_DOC: [PDF, DOC, DOCX, XLS, XLSX],
  COVER_LETTER: [PDF, DOC, DOCX],
  OTHER: [PDF, DOC, DOCX, PNG, JPEG],
};

export interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PresignedUrlResult {
  url: string;
  expiresAt: string;
}

function toMeta(row: repo.DocumentMetaRow): DocumentMeta {
  return {
    id: row.id,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadDocument(
  user: AccessUser,
  meta: UploadMeta,
  file: UploadFile | undefined,
): Promise<DocumentMeta> {
  if (!file) {
    throw AppError.badRequest('Missing file', { code: 'NO_FILE' });
  }

  // 1. Authorize (role + matrix + CONSULTANT ownership) BEFORE touching storage.
  await access.assertCanUpload(user, meta.entityType, meta.entityId, meta.type);

  // 2. The polymorphic target must exist.
  // TODO(orphan-cleanup): entity-existence check is not atomic with putObject/createDocument (polymorphic FK)
  const exists = await repo.entityExists(meta.entityType, meta.entityId);
  if (!exists) {
    throw AppError.notFound('Target entity not found');
  }

  // 3. Mime allowlist (NOTE: multer mimetype is client-controlled).
  // TODO(magic-bytes): verify the file signature with the file-type package.
  const allowed = MIME_ALLOWLIST[meta.type];
  if (!allowed.includes(file.mimetype)) {
    throw AppError.badRequest('File type not allowed for this document type', {
      code: 'BAD_MIME',
    });
  }

  // 4. Size cap (multer also enforces this; double-check defensively).
  if (file.size > MAX_SIZE_BYTES) {
    throw AppError.badRequest('File exceeds the maximum size', { code: 'FILE_TOO_LARGE' });
  }

  // TODO(virus-scan): scan asynchronously before the document is downloadable.

  // 5. Server-generated, sanitized, non-guessable key (path-traversal safe).
  const storageKey = buildStorageKey(meta.entityType, meta.entityId, file.originalname);
  await putObject({ key: storageKey, body: file.buffer, contentType: file.mimetype });

  const row = await repo.createDocument({
    type: meta.type,
    entityType: meta.entityType,
    entityId: meta.entityId,
    filename: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    storageKey,
    uploadedById: user.id,
  });

  await repo.writeAuditLog({
    entityType: meta.entityType,
    entityId: meta.entityId,
    action: 'DOCUMENT_UPLOAD',
    actorId: user.id,
    payload: { docId: row.id, type: meta.type, filename: row.filename },
  });

  return toMeta(row);
}

// ---------------------------------------------------------------------------
// Download URL
// ---------------------------------------------------------------------------

export async function getDocumentUrl(user: AccessUser, id: string): Promise<PresignedUrlResult> {
  const doc = await repo.findActiveDocumentById(id);
  if (!doc) {
    throw AppError.notFound('Document not found');
  }

  await access.assertCanDownload(user, { entityType: doc.entityType, entityId: doc.entityId });

  const url = await getPresignedGetUrl(doc.storageKey, URL_EXPIRY_SEC);
  const expiresAt = new Date(Date.now() + URL_EXPIRY_SEC * 1000).toISOString();

  await repo.writeAuditLog({
    entityType: doc.entityType,
    entityId: doc.entityId,
    action: 'DOCUMENT_DOWNLOAD',
    actorId: user.id,
    payload: { docId: doc.id },
  });

  return { url, expiresAt };
}

// ---------------------------------------------------------------------------
// List (scoped by the same download check)
// ---------------------------------------------------------------------------

export async function listDocuments(
  user: AccessUser,
  query: ListDocumentsQuery,
): Promise<PaginatedResult<DocumentMeta>> {
  await access.assertCanDownload(user, {
    entityType: query.entityType,
    entityId: query.entityId,
  });

  const pagination: Pagination = { page: query.page, pageSize: query.pageSize };
  const { items, total } = await repo.listDocuments(query.entityType, query.entityId, pagination);
  return { data: items.map(toMeta), page: query.page, pageSize: query.pageSize, total };
}

// ---------------------------------------------------------------------------
// Soft-delete / restore (RH, DIRECTION only — MinIO object retained)
// ---------------------------------------------------------------------------

export async function softDelete(user: AccessUser, id: string): Promise<void> {
  const doc = await repo.findDocumentByIdAny(id);
  if (!doc) {
    throw AppError.notFound('Document not found');
  }

  access.assertCanDelete(user, { entityType: doc.entityType, entityId: doc.entityId });

  // Idempotent: already-archived is a no-op (object is RETAINED — no deleteObject).
  if (doc.archivedAt) {
    return;
  }

  await repo.softDeleteDocument(id);

  await repo.writeAuditLog({
    entityType: doc.entityType,
    entityId: doc.entityId,
    action: 'DOCUMENT_DELETE',
    actorId: user.id,
    payload: { docId: doc.id, type: doc.type },
  });
}

export async function restore(user: AccessUser, id: string): Promise<void> {
  const doc = await repo.findDocumentByIdAny(id);
  if (!doc) {
    throw AppError.notFound('Document not found');
  }

  access.assertCanDelete(user, { entityType: doc.entityType, entityId: doc.entityId });

  // Idempotent: an already-active document is a no-op (no DB write, no audit).
  if (doc.archivedAt === null) {
    return;
  }

  await repo.restoreDocument(id);

  await repo.writeAuditLog({
    entityType: doc.entityType,
    entityId: doc.entityId,
    action: 'DOCUMENT_RESTORE',
    actorId: user.id,
    payload: { docId: doc.id, type: doc.type },
  });
}

// Exported so unit tests can reference the allowlist defaults.
export { MIME_ALLOWLIST };
