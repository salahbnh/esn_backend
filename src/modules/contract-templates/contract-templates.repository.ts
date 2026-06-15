import type { ContractTemplate, EntityType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Contract-templates data-access layer. The ONLY file in this sub-module that
 * imports the Prisma client. Pure data access — no business logic.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface TemplateFilter {
  includeInactive: boolean;
}

export interface CreateTemplateData {
  name: string;
  body: string;
}

export interface UpdateTemplateData {
  name?: string;
  body?: string;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function findTemplateById(id: string): Promise<ContractTemplate | null> {
  return prisma.contractTemplate.findUnique({ where: { id } });
}

export async function listTemplates(filter: TemplateFilter, pagination: Pagination) {
  const where: Prisma.ContractTemplateWhereInput = {};
  if (!filter.includeInactive) {
    where.isActive = true;
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.contractTemplate.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contractTemplate.count({ where }),
  ]);
  return { items, total };
}

export function createTemplate(data: CreateTemplateData): Promise<ContractTemplate> {
  return prisma.contractTemplate.create({ data });
}

export function updateTemplate(
  id: string,
  data: UpdateTemplateData,
): Promise<ContractTemplate> {
  return prisma.contractTemplate.update({ where: { id }, data });
}

export function deactivateTemplate(id: string): Promise<ContractTemplate> {
  return prisma.contractTemplate.update({ where: { id }, data: { isActive: false } });
}

// ---------------------------------------------------------------------------
// Audit (non-transactional, best-effort for standalone mutations)
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  entry: AuditLogData,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({ data: entry });
}
