import type { Document, DocumentType, EntityType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Documents data-access layer. The ONLY documents-module file that imports the
 * Prisma client. Ownership resolvers are read-only queries here so the access
 * layer stays Prisma-free (no circular module dependency — we mirror the minimal
 * cross-entity query locally rather than importing another module's service).
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface CreateDocumentData {
  type: DocumentType;
  entityType: EntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedById: string;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

/** Metadata projection — NEVER selects `storageKey`. */
const META_SELECT = {
  id: true,
  type: true,
  entityType: true,
  entityId: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  uploadedById: true,
  createdAt: true,
} as const;

export type DocumentMetaRow = Prisma.DocumentGetPayload<{ select: typeof META_SELECT }>;

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Document rows
// ---------------------------------------------------------------------------

export function createDocument(data: CreateDocumentData): Promise<DocumentMetaRow> {
  return prisma.document.create({ data, select: META_SELECT });
}

/** Full row INCLUDING storageKey — internal use only (download). Active only. */
export function findActiveDocumentById(id: string): Promise<Document | null> {
  return prisma.document.findFirst({ where: { id, archivedAt: null } });
}

/** Full row INCLUDING storageKey, including archived — for delete/restore. */
export function findDocumentByIdAny(id: string): Promise<Document | null> {
  return prisma.document.findUnique({ where: { id } });
}

export async function listDocuments(
  entityType: EntityType,
  entityId: string,
  pagination: Pagination,
): Promise<{ items: DocumentMetaRow[]; total: number }> {
  const where: Prisma.DocumentWhereInput = { entityType, entityId, archivedAt: null };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: META_SELECT,
    }),
    prisma.document.count({ where }),
  ]);
  return { items, total };
}

export async function softDeleteDocument(id: string): Promise<void> {
  await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function restoreDocument(id: string): Promise<void> {
  await prisma.document.update({ where: { id }, data: { archivedAt: null } });
}

// ---------------------------------------------------------------------------
// Ownership resolvers (read-only) — never trust ids from the request body
// ---------------------------------------------------------------------------

export async function resolveConsultantOwnerUserId(consultantId: string): Promise<string | null> {
  const row = await prisma.consultant.findUnique({
    where: { id: consultantId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

export async function resolveContractOwnerUserId(contractId: string): Promise<string | null> {
  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { consultant: { select: { userId: true } } },
  });
  return row?.consultant.userId ?? null;
}

export async function resolveAssignmentOwnerUserId(assignmentId: string): Promise<string | null> {
  const row = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { consultant: { select: { userId: true } } },
  });
  return row?.consultant.userId ?? null;
}

export async function findConsultantIdByUserId(userId: string): Promise<string | null> {
  const row = await prisma.consultant.findUnique({
    where: { userId },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** True iff the consultant has an ACTIVE or CONFIRMED assignment on the mission. */
export async function consultantHasMissionAssignment(
  consultantId: string,
  missionId: string,
): Promise<boolean> {
  const row = await prisma.assignment.findFirst({
    where: {
      consultantId,
      missionId,
      status: { in: ['ACTIVE', 'CONFIRMED'] },
    },
    select: { id: true },
  });
  return row !== null;
}

/** Verify the polymorphic target entity exists before writing a Document row. */
export async function entityExists(entityType: EntityType, entityId: string): Promise<boolean> {
  const sel = { id: true } as const;
  let id: string | undefined;
  switch (entityType) {
    case 'CANDIDATE':
      id = (await prisma.candidate.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'CONSULTANT':
      id = (await prisma.consultant.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'CLIENT':
      id = (await prisma.client.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'MISSION':
      id = (await prisma.mission.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'CONTRACT':
      id = (await prisma.contract.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'CONTRACT_TEMPLATE':
      id = (await prisma.contractTemplate.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    case 'ASSIGNMENT':
      id = (await prisma.assignment.findUnique({ where: { id: entityId }, select: sel }))?.id;
      break;
    default:
      return false;
  }
  return id !== undefined;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  entry: AuditLogData,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({ data: entry });
}
