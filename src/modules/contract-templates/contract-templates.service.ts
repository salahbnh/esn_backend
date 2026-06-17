import type { ContractTemplate } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './contract-templates.repository.js';
import type { Pagination } from './contract-templates.repository.js';
import {
  parseTemplatePlaceholders,
  type TemplatePlaceholder,
} from './template-placeholders.js';
import type {
  CreateTemplateBody,
  ListTemplatesQuery,
  UpdateTemplateBody,
} from './contract-templates.schema.js';

/**
 * Contract-templates business logic. Throws AppError on domain violations.
 * Never imports the Prisma client.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadTemplateOr404(id: string): Promise<ContractTemplate> {
  const template = await repo.findTemplateById(id);
  if (!template) {
    throw AppError.notFound('Contract template not found');
  }
  return template;
}

export async function listTemplates(
  query: ListTemplatesQuery,
): Promise<PaginatedResult<ContractTemplate>> {
  const { items, total } = await repo.listTemplates(
    { includeInactive: query.includeInactive },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export interface TemplateDetail extends ContractTemplate {
  placeholders: TemplatePlaceholder[];
}

/**
 * Template detail with the placeholders introspected from its body. The
 * frontend builds the RH input form (auto vs manual) from `placeholders`, so
 * new templates need no code change.
 */
export async function getTemplate(id: string): Promise<TemplateDetail> {
  const template = await loadTemplateOr404(id);
  return { ...template, placeholders: parseTemplatePlaceholders(template.body) };
}

export async function createTemplate(
  body: CreateTemplateBody,
  actorId: string,
): Promise<ContractTemplate> {
  const template = await repo.createTemplate({ name: body.name, body: body.body });
  await repo.writeAuditLog({
    entityType: 'CONTRACT_TEMPLATE',
    entityId: template.id,
    action: 'CREATE',
    actorId,
    payload: { name: template.name },
  });
  return template;
}

export async function updateTemplate(
  id: string,
  body: UpdateTemplateBody,
  actorId: string,
): Promise<ContractTemplate> {
  await loadTemplateOr404(id);
  const template = await repo.updateTemplate(id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.body !== undefined ? { body: body.body } : {}),
  });
  await repo.writeAuditLog({
    entityType: 'CONTRACT_TEMPLATE',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return template;
}

export async function deactivateTemplate(
  id: string,
  actorId: string,
): Promise<ContractTemplate> {
  await loadTemplateOr404(id);
  const template = await repo.deactivateTemplate(id);
  await repo.writeAuditLog({
    entityType: 'CONTRACT_TEMPLATE',
    entityId: id,
    action: 'DEACTIVATE',
    actorId,
    payload: { isActive: false },
  });
  return template;
}

// Re-export for symmetry with other modules' pagination type usage.
export type { Pagination };
