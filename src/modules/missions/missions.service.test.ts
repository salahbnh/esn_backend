import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, MissionAmendment, MissionStatus } from '@prisma/client';
import {
  CreateMissionBodySchema,
  MissionStatusTransitionBodySchema,
  UpdateMissionBodySchema,
} from './missions.schema.js';

// Mock the repository. The service is tested in isolation — no DB, no network.
vi.mock('./missions.repository.js');
// Stub the logger so importing the service (transitively) doesn't pull in the
// env-validating config module (which calls process.exit on missing env).
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './missions.repository.js';
import * as service from './missions.service.js';

const mockRepo = vi.mocked(repo);

function mission(overrides: Record<string, unknown> = {}): Mission {
  return {
    id: 'mis1',
    clientId: 'client1',
    project: 'Apollo',
    role: 'Backend Engineer',
    description: null,
    startDate: new Date(),
    endDate: null,
    tjm: '500.00',
    status: 'DRAFT',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Mission;
}

function amendment(overrides: Record<string, unknown> = {}): MissionAmendment {
  return {
    id: 'amd1',
    missionId: 'mis1',
    reason: 'Scope change',
    changes: { tjm: { from: '500.00', to: '550.00' } },
    effectiveDate: new Date(),
    createdById: 'actor1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as MissionAmendment;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

describe('changeStatus', () => {
  it('DRAFT -> STAFFED succeeds and writes a STATUS_CHANGE audit', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'DRAFT' }));
    mockRepo.updateMissionStatus.mockResolvedValue(mission({ status: 'STAFFED' }));
    const result = await service.changeStatus('mis1', 'STAFFED', 'ready', 'actor1');
    expect(result).toMatchObject({ status: 'STAFFED' });
    expect(mockRepo.updateMissionStatus).toHaveBeenCalledWith('mis1', 'STAFFED');
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        actorId: 'actor1',
        entityType: 'MISSION',
        entityId: 'mis1',
        payload: expect.objectContaining({ from: 'DRAFT', to: 'STAFFED', comment: 'ready' }),
      }),
    );
  });

  it('STAFFED -> IN_PROGRESS succeeds', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'STAFFED' }));
    mockRepo.updateMissionStatus.mockResolvedValue(mission({ status: 'IN_PROGRESS' }));
    const result = await service.changeStatus('mis1', 'IN_PROGRESS', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('STAFFED -> DRAFT succeeds (de-staff)', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'STAFFED' }));
    mockRepo.updateMissionStatus.mockResolvedValue(mission({ status: 'DRAFT' }));
    const result = await service.changeStatus('mis1', 'DRAFT', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'DRAFT' });
  });

  it('IN_PROGRESS -> CLOSED succeeds and writes an audit', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'IN_PROGRESS' }));
    mockRepo.updateMissionStatus.mockResolvedValue(mission({ status: 'CLOSED' }));
    const result = await service.changeStatus('mis1', 'CLOSED', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'CLOSED' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalled();
  });

  it('DRAFT -> IN_PROGRESS throws INVALID_TRANSITION (400) — must pass STAFFED first', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'DRAFT' }));
    await expect(
      service.changeStatus('mis1', 'IN_PROGRESS', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_TRANSITION' } });
    expect(mockRepo.updateMissionStatus).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).not.toHaveBeenCalled();
  });

  it('DRAFT -> DRAFT (same state) throws 400', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'DRAFT' }));
    await expect(
      service.changeStatus('mis1', 'DRAFT', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_TRANSITION' } });
    expect(mockRepo.updateMissionStatus).not.toHaveBeenCalled();
  });

  it('CLOSED -> DRAFT throws 400 (terminal)', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'CLOSED' }));
    await expect(
      service.changeStatus('mis1', 'DRAFT', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.updateMissionStatus).not.toHaveBeenCalled();
  });

  it('ARCHIVED -> IN_PROGRESS throws 400 (terminal)', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'ARCHIVED' }));
    await expect(
      service.changeStatus('mis1', 'IN_PROGRESS', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('DRAFT -> ARCHIVED via /status throws 400 (use /archive)', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'DRAFT' }));
    // The service layer also rejects this: ARCHIVED is not in any allowed list.
    await expect(
      service.changeStatus('mis1', 'ARCHIVED' as MissionStatus, undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.updateMissionStatus).not.toHaveBeenCalled();
  });

  it('throws 404 when the mission does not exist', async () => {
    mockRepo.findMissionById.mockResolvedValue(null);
    await expect(
      service.changeStatus('missing', 'STAFFED', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateMissionStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Archive (idempotent)
// ---------------------------------------------------------------------------

describe('archiveMission', () => {
  it('sets archivedAt + status ARCHIVED and writes an ARCHIVE audit', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission({ status: 'IN_PROGRESS' }));
    mockRepo.archiveMission.mockResolvedValue(
      mission({ status: 'ARCHIVED', archivedAt: new Date() }),
    );
    const result = await service.archiveMission('mis1', 'actor1');
    expect(result).toMatchObject({ status: 'ARCHIVED' });
    expect(mockRepo.archiveMission).toHaveBeenCalledWith('mis1');
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ARCHIVE', entityType: 'MISSION', entityId: 'mis1' }),
    );
  });

  it('is idempotent — already ARCHIVED does not write again', async () => {
    mockRepo.findMissionById.mockResolvedValue(
      mission({ status: 'ARCHIVED', archivedAt: new Date() }),
    );
    const result = await service.archiveMission('mis1', 'actor1');
    expect(result).toMatchObject({ status: 'ARCHIVED' });
    expect(mockRepo.archiveMission).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).not.toHaveBeenCalled();
  });

  it('throws 404 when the mission does not exist', async () => {
    mockRepo.findMissionById.mockResolvedValue(null);
    await expect(service.archiveMission('missing', 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockRepo.archiveMission).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Amendment creation
// ---------------------------------------------------------------------------

describe('createAmendment', () => {
  it('creates an amendment with createdById set to the actor', async () => {
    mockRepo.findMissionById.mockResolvedValue(mission());
    mockRepo.createAmendment.mockResolvedValue(amendment({ createdById: 'actor1' }));
    const result = await service.createAmendment(
      'mis1',
      { reason: 'Scope change', changes: { x: 1 }, effectiveDate: new Date().toISOString() },
      'actor1',
    );
    expect(result).toMatchObject({ createdById: 'actor1' });
    expect(mockRepo.createAmendment).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: 'mis1', createdById: 'actor1', reason: 'Scope change' }),
    );
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AMENDMENT_CREATE',
        entityType: 'MISSION',
        entityId: 'mis1',
        actorId: 'actor1',
      }),
    );
  });

  it('throws 404 when the mission does not exist', async () => {
    mockRepo.findMissionById.mockResolvedValue(null);
    await expect(
      service.createAmendment(
        'missing',
        { reason: 'x', changes: {}, effectiveDate: new Date().toISOString() },
        'actor1',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.createAmendment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Schema-level checks
// ---------------------------------------------------------------------------

describe('CreateMissionBodySchema .strict()', () => {
  it('rejects an unknown field', () => {
    const parsed = CreateMissionBodySchema.safeParse({
      clientId: 'clxxxxxxxxxxxxxxxxxxxxxxxx',
      project: 'Apollo',
      role: 'Engineer',
      startDate: new Date().toISOString(),
      tjm: '500.00',
      bogus: 'nope',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a valid body and defaults requiredSkillIds to []', () => {
    const parsed = CreateMissionBodySchema.safeParse({
      clientId: 'clxxxxxxxxxxxxxxxxxxxxxxxx',
      project: 'Apollo',
      role: 'Engineer',
      startDate: new Date().toISOString(),
      tjm: '500.00',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requiredSkillIds).toEqual([]);
    }
  });
});

describe('MissionStatusTransitionBodySchema', () => {
  it('rejects ARCHIVED as a target status', () => {
    const parsed = MissionStatusTransitionBodySchema.safeParse({ status: 'ARCHIVED' });
    expect(parsed.success).toBe(false);
  });

  it('accepts a non-archive target status', () => {
    const parsed = MissionStatusTransitionBodySchema.safeParse({ status: 'STAFFED' });
    expect(parsed.success).toBe(true);
  });
});

describe('UpdateMissionBodySchema', () => {
  it('all fields optional — empty object is valid', () => {
    expect(UpdateMissionBodySchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unknown field (.strict())', () => {
    expect(UpdateMissionBodySchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});
