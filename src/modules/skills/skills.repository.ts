import type { Prisma, Skill } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Skills data-access layer. The ONLY skills-module file that imports the Prisma
 * client. Pure, deliberate data access — no business logic.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface SkillFilter {
  search?: string;
  category?: string;
}

export interface CreateSkillData {
  name: string;
  category?: string | null;
}

export interface UpdateSkillData {
  name?: string;
  category?: string | null;
}

export interface SkillUsage {
  candidates: number;
  consultants: number;
  missions: number;
  total: number;
}

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function findSkillById(id: string): Promise<Skill | null> {
  return prisma.skill.findUnique({ where: { id } });
}

export async function listSkills(filter: SkillFilter, pagination: Pagination) {
  const where: Prisma.SkillWhereInput = {};
  if (filter.search) {
    where.name = { contains: filter.search, mode: 'insensitive' };
  }
  if (filter.category) {
    where.category = filter.category;
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.skill.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
    prisma.skill.count({ where }),
  ]);
  return { items, total };
}

export function createSkill(data: CreateSkillData): Promise<Skill> {
  return prisma.skill.create({ data });
}

export function updateSkill(id: string, data: UpdateSkillData): Promise<Skill> {
  return prisma.skill.update({ where: { id }, data });
}

export function deleteSkill(id: string): Promise<Skill> {
  return prisma.skill.delete({ where: { id } });
}

/** Count how many candidates / consultants / missions reference this skill. */
export async function countSkillUsage(id: string): Promise<SkillUsage> {
  const [candidates, consultants, missions] = await Promise.all([
    prisma.candidate.count({ where: { skills: { some: { id } } } }),
    prisma.consultant.count({ where: { skills: { some: { id } } } }),
    prisma.mission.count({ where: { requiredSkills: { some: { id } } } }),
  ]);
  return { candidates, consultants, missions, total: candidates + consultants + missions };
}
