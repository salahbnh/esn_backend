import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('./skills.repository.js');

import * as repo from './skills.repository.js';
import * as service from './skills.service.js';

const mockRepo = vi.mocked(repo);

function skill(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    name: 'Go',
    category: 'Backend',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSkill', () => {
  it('creates a skill, trimming name + normalizing category', async () => {
    mockRepo.createSkill.mockResolvedValue(skill());
    await service.createSkill({ name: '  Go  ', category: 'backend' });
    expect(mockRepo.createSkill).toHaveBeenCalledWith({ name: 'Go', category: 'Backend' });
  });

  it('maps a unique-name violation to 409 SKILL_ALREADY_EXISTS', async () => {
    mockRepo.createSkill.mockRejectedValue(p2002());
    await expect(service.createSkill({ name: 'Go' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'SKILL_ALREADY_EXISTS' },
    });
  });
});

describe('updateSkill', () => {
  it('404 when the skill does not exist', async () => {
    mockRepo.findSkillById.mockResolvedValue(null);
    await expect(service.updateSkill('missing', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockRepo.updateSkill).not.toHaveBeenCalled();
  });

  it('maps a name collision to 409', async () => {
    mockRepo.findSkillById.mockResolvedValue(skill());
    mockRepo.updateSkill.mockRejectedValue(p2002());
    await expect(service.updateSkill('s1', { name: 'Rust' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'SKILL_ALREADY_EXISTS' },
    });
  });
});

describe('removeSkill', () => {
  it('404 when the skill does not exist', async () => {
    mockRepo.findSkillById.mockResolvedValue(null);
    await expect(service.removeSkill('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409 SKILL_IN_USE with a breakdown when referenced', async () => {
    mockRepo.findSkillById.mockResolvedValue(skill());
    mockRepo.countSkillUsage.mockResolvedValue({
      candidates: 0,
      consultants: 2,
      missions: 1,
      total: 3,
    });
    await expect(service.removeSkill('s1')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'SKILL_IN_USE', total: 3, breakdown: { consultants: 2, missions: 1 } },
    });
    expect(mockRepo.deleteSkill).not.toHaveBeenCalled();
  });

  it('deletes when unused', async () => {
    mockRepo.findSkillById.mockResolvedValue(skill());
    mockRepo.countSkillUsage.mockResolvedValue({ candidates: 0, consultants: 0, missions: 0, total: 0 });
    mockRepo.deleteSkill.mockResolvedValue(skill());
    await service.removeSkill('s1');
    expect(mockRepo.deleteSkill).toHaveBeenCalledWith('s1');
  });
});

describe('listSkills', () => {
  it('delegates filter + pagination to the repository', async () => {
    mockRepo.listSkills.mockResolvedValue({ items: [skill()], total: 1 });
    const res = await service.listSkills({ search: 'go', page: 1, pageSize: 50 });
    expect(mockRepo.listSkills).toHaveBeenCalledWith({ search: 'go' }, { page: 1, pageSize: 50 });
    expect(res).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  });
});
