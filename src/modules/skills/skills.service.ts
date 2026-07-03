import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './skills.repository.js';
import type { CreateSkillBody, ListSkillsQuery, UpdateSkillBody } from './skills.schema.js';

/**
 * Skills referential business logic. Throws AppError on domain violations. Never
 * imports the Prisma client. Skills are org-level (no ownership). Manage =
 * RH/DIRECTION; read = all authenticated roles (enforced in the routes).
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

type SkillListItem = Awaited<ReturnType<typeof repo.listSkills>>['items'][number];

function paginated<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

/** Reduce free-form category drift ("frontend" → "Frontend") without mangling case. */
function normalizeCategory(category?: string): string | undefined {
  if (category === undefined) return undefined;
  const trimmed = category.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function listSkills(query: ListSkillsQuery): Promise<PaginatedResult<SkillListItem>> {
  const { items, total } = await repo.listSkills(
    {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.category !== undefined ? { category: query.category } : {}),
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function createSkill(body: CreateSkillBody, actorId: string) {
  let skill;
  try {
    skill = await repo.createSkill({
      name: body.name.trim(),
      ...(normalizeCategory(body.category) !== undefined
        ? { category: normalizeCategory(body.category) }
        : {}),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.conflict('A skill with this name already exists', {
        code: 'SKILL_ALREADY_EXISTS',
      });
    }
    throw err;
  }
  await repo.writeAuditLog({
    entityType: 'SKILL',
    entityId: skill.id,
    action: 'CREATE',
    actorId,
    payload: { name: skill.name },
  });
  return skill;
}

export async function updateSkill(id: string, body: UpdateSkillBody, actorId: string) {
  const existing = await repo.findSkillById(id);
  if (!existing) {
    throw AppError.notFound('Skill not found');
  }
  let skill;
  try {
    skill = await repo.updateSkill(id, {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.category !== undefined ? { category: normalizeCategory(body.category) ?? null } : {}),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw AppError.conflict('A skill with this name already exists', {
        code: 'SKILL_ALREADY_EXISTS',
      });
    }
    throw err;
  }
  await repo.writeAuditLog({
    entityType: 'SKILL',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return skill;
}

export async function removeSkill(id: string, actorId: string): Promise<void> {
  const existing = await repo.findSkillById(id);
  if (!existing) {
    throw AppError.notFound('Skill not found');
  }
  const usage = await repo.countSkillUsage(id);
  if (usage.total > 0) {
    throw AppError.conflict('Skill is in use and cannot be deleted', {
      code: 'SKILL_IN_USE',
      total: usage.total,
      breakdown: {
        candidates: usage.candidates,
        consultants: usage.consultants,
        missions: usage.missions,
      },
    });
  }
  await repo.deleteSkill(id);
  await repo.writeAuditLog({
    entityType: 'SKILL',
    entityId: id,
    action: 'DELETE',
    actorId,
    payload: { name: existing.name },
  });
}
