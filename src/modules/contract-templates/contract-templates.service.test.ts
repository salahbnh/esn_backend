import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractTemplate } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';

// Mock the repository (no Prisma touched) and the logger (so importing the
// service doesn't pull in env-validating config).
vi.mock('./contract-templates.repository.js');
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './contract-templates.repository.js';
import * as service from './contract-templates.service.js';

const mockRepo = vi.mocked(repo);

function template(overrides: Partial<ContractTemplate> = {}): ContractTemplate {
  return {
    id: 'tmpl1',
    name: 'CDI standard',
    body: 'Hello {{firstName}}',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ContractTemplate;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
});

describe('createTemplate', () => {
  it('creates and writes a CONTRACT_TEMPLATE audit log', async () => {
    mockRepo.createTemplate.mockResolvedValue(template());

    const res = await service.createTemplate({ name: 'CDI standard', body: 'x' }, 'actor1');

    expect(res.id).toBe('tmpl1');
    expect(mockRepo.createTemplate).toHaveBeenCalledWith({ name: 'CDI standard', body: 'x' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'CONTRACT_TEMPLATE', entityId: 'tmpl1', actorId: 'actor1' }),
    );
  });
});

describe('getTemplate', () => {
  it('returns the template when found', async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    const res = await service.getTemplate('tmpl1');
    expect(res.id).toBe('tmpl1');
  });

  it('throws 404 when not found', async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    await expect(service.getTemplate('nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getTemplate('nope')).rejects.toBeInstanceOf(AppError);
  });
});

describe('updateTemplate', () => {
  it('throws 404 when the template does not exist', async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    await expect(
      service.updateTemplate('nope', { name: 'x' }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateTemplate).not.toHaveBeenCalled();
  });

  it('updates an existing template and audits', async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    mockRepo.updateTemplate.mockResolvedValue(template({ name: 'CDD standard' }));

    const res = await service.updateTemplate('tmpl1', { name: 'CDD standard' }, 'actor1');

    expect(res.name).toBe('CDD standard');
    expect(mockRepo.updateTemplate).toHaveBeenCalledWith('tmpl1', { name: 'CDD standard' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'CONTRACT_TEMPLATE', action: 'UPDATE', actorId: 'actor1' }),
    );
  });
});

describe('deactivateTemplate', () => {
  it('throws 404 when the template does not exist', async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    await expect(
      service.deactivateTemplate('nope', 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.deactivateTemplate).not.toHaveBeenCalled();
  });

  it('deactivates an existing template and audits', async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    mockRepo.deactivateTemplate.mockResolvedValue(template({ isActive: false }));

    const res = await service.deactivateTemplate('tmpl1', 'actor1');

    expect(res.isActive).toBe(false);
    expect(mockRepo.deactivateTemplate).toHaveBeenCalledWith('tmpl1');
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'CONTRACT_TEMPLATE', actorId: 'actor1' }),
    );
  });
});
