import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Consultant } from '@prisma/client';
import { UpdateOwnProfileBodySchema } from './consultants.schema.js';

// Mock the repository. The service is tested in isolation — no DB, no network.
vi.mock('./consultants.repository.js');
// Stub the logger so importing the service (transitively) doesn't pull in the
// env-validating config module (which calls process.exit on missing env).
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './consultants.repository.js';
import * as service from './consultants.service.js';

const mockRepo = vi.mocked(repo);

function baseConsultant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cons1',
    userId: 'user1',
    position: 'Backend Engineer',
    tjm: null,
    status: 'AVAILABLE',
    hireDate: null,
    availabilityDate: null,
    seniority: null,
    bio: null,
    candidateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function consultant(overrides: Record<string, unknown> = {}): Consultant {
  return baseConsultant(overrides) as unknown as Consultant;
}

// Detail/with-relations shape used for findConsultantByUserId / updateConsultant /
// findConsultantDetailByUserId. Those repo fns return richer Prisma payloads than
// the bare Consultant row, so the mock value is cast to the awaited return type.
// Non-nullable relational payload (the `updateConsultant` return). It is also
// assignable to the nullable `findConsultantByUserId` mock value.
function consultantWithRelations(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof repo.updateConsultant>> {
  return {
    ...baseConsultant(overrides),
    user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    skills: [],
  } as unknown as Awaited<ReturnType<typeof repo.updateConsultant>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Status transitions (all reversible, no terminal states)
// ---------------------------------------------------------------------------

describe('changeStatus', () => {
  it('AVAILABLE -> INTERCONTRAT succeeds and writes a STATUS_CHANGE audit', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'AVAILABLE' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'INTERCONTRAT' }));
    const result = await service.changeStatus('cons1', 'INTERCONTRAT', 'planning', 'actor1');
    expect(result).toMatchObject({ status: 'INTERCONTRAT' });
    expect(mockRepo.updateConsultantStatus).toHaveBeenCalledWith('cons1', 'INTERCONTRAT');
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        actorId: 'actor1',
        entityType: 'CONSULTANT',
        entityId: 'cons1',
        payload: expect.objectContaining({ from: 'AVAILABLE', to: 'INTERCONTRAT', comment: 'planning' }),
      }),
    );
  });

  it('AVAILABLE -> ON_MISSION succeeds', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'AVAILABLE' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'ON_MISSION' }));
    const result = await service.changeStatus('cons1', 'ON_MISSION', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'ON_MISSION' });
  });

  it('INTERCONTRAT -> AVAILABLE succeeds (reversible)', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'INTERCONTRAT' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'AVAILABLE' }));
    const result = await service.changeStatus('cons1', 'AVAILABLE', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'AVAILABLE' });
  });

  it('INTERCONTRAT -> ON_MISSION succeeds', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'INTERCONTRAT' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'ON_MISSION' }));
    const result = await service.changeStatus('cons1', 'ON_MISSION', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'ON_MISSION' });
  });

  it('ON_MISSION -> AVAILABLE succeeds (reversible)', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'ON_MISSION' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'AVAILABLE' }));
    const result = await service.changeStatus('cons1', 'AVAILABLE', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'AVAILABLE' });
  });

  it('ON_MISSION -> INTERCONTRAT succeeds (reversible)', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'ON_MISSION' }));
    mockRepo.updateConsultantStatus.mockResolvedValue(consultant({ status: 'INTERCONTRAT' }));
    const result = await service.changeStatus('cons1', 'INTERCONTRAT', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'INTERCONTRAT' });
  });

  it('AVAILABLE -> AVAILABLE (same state) throws INVALID_TRANSITION (400)', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'AVAILABLE' }));
    await expect(
      service.changeStatus('cons1', 'AVAILABLE', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_TRANSITION' } });
    expect(mockRepo.updateConsultantStatus).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).not.toHaveBeenCalled();
  });

  it('ON_MISSION -> ON_MISSION (same state) throws 400', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant({ status: 'ON_MISSION' }));
    await expect(
      service.changeStatus('cons1', 'ON_MISSION', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.updateConsultantStatus).not.toHaveBeenCalled();
  });

  it('throws 404 when consultant not found', async () => {
    mockRepo.findConsultantById.mockResolvedValue(null);
    await expect(
      service.changeStatus('missing', 'ON_MISSION', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateConsultantStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Self-edit profile — allowed fields, audit, field restriction, skill mapping
// ---------------------------------------------------------------------------

describe('updateOwnProfile', () => {
  it('updates allowed fields and writes an UPDATE audit (self)', async () => {
    mockRepo.findConsultantByUserId.mockResolvedValue(consultantWithRelations());
    mockRepo.updateConsultant.mockResolvedValue(
      consultantWithRelations({ bio: 'hello', seniority: 'Senior' }),
    );
    const result = await service.updateOwnProfile('user1', {
      bio: 'hello',
      seniority: 'Senior',
    });
    expect(result).toMatchObject({ bio: 'hello', seniority: 'Senior' });
    expect(mockRepo.updateConsultant).toHaveBeenCalledWith(
      'cons1',
      expect.objectContaining({ bio: 'hello', seniority: 'Senior' }),
    );
    // The actor for a self-edit is the owning userId (no separate actorId param).
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        actorId: 'user1',
        entityType: 'CONSULTANT',
        entityId: 'cons1',
      }),
    );
  });

  it('throws 404 when no consultant is linked to the userId', async () => {
    mockRepo.findConsultantByUserId.mockResolvedValue(null);
    await expect(
      service.updateOwnProfile('userX', { bio: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateConsultant).not.toHaveBeenCalled();
  });

  it('schema rejects `position` in the self-edit body (.strict())', () => {
    const parsed = UpdateOwnProfileBodySchema.safeParse({ bio: 'x', position: 'Lead' });
    expect(parsed.success).toBe(false);
  });

  it('schema accepts the allowed self-edit fields only', () => {
    const parsed = UpdateOwnProfileBodySchema.safeParse({
      bio: 'x',
      seniority: 'Senior',
      skillIds: [],
    });
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skill replacement mapping (repo receives skillIds; set:[] clears all)
// ---------------------------------------------------------------------------

describe('skillIds replacement', () => {
  it('updateConsultant passes skillIds through to the repository', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant());
    mockRepo.updateConsultant.mockResolvedValue(consultantWithRelations());
    await service.updateConsultant('cons1', { skillIds: ['skill1', 'skill2'] }, 'actor1');
    expect(mockRepo.updateConsultant).toHaveBeenCalledWith(
      'cons1',
      expect.objectContaining({ skillIds: ['skill1', 'skill2'] }),
    );
  });

  it('an empty skillIds array is forwarded (clears the skill set)', async () => {
    mockRepo.findConsultantById.mockResolvedValue(consultant());
    mockRepo.updateConsultant.mockResolvedValue(consultantWithRelations());
    await service.updateConsultant('cons1', { skillIds: [] }, 'actor1');
    expect(mockRepo.updateConsultant).toHaveBeenCalledWith(
      'cons1',
      expect.objectContaining({ skillIds: [] }),
    );
  });
});

// ---------------------------------------------------------------------------
// getOwnProfile
// ---------------------------------------------------------------------------

function consultantDetail(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof repo.findConsultantDetailByUserId>> {
  return {
    ...baseConsultant(overrides),
    user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    skills: [],
    _assignmentCount: 0,
    documents: [],
  } as unknown as Awaited<ReturnType<typeof repo.findConsultantDetailByUserId>>;
}

describe('getOwnProfile', () => {
  it('returns the DETAIL shape via findConsultantDetailByUserId', async () => {
    mockRepo.findConsultantDetailByUserId.mockResolvedValue(consultantDetail());
    const result = await service.getOwnProfile('user1');
    // /me must return the same detail shape as /:id (assignment count + documents).
    expect(mockRepo.findConsultantDetailByUserId).toHaveBeenCalledWith('user1');
    expect(result).toMatchObject({ id: 'cons1', _assignmentCount: 0, documents: [] });
  });

  it('throws 404 when no consultant is linked to the userId', async () => {
    mockRepo.findConsultantDetailByUserId.mockResolvedValue(null);
    await expect(service.getOwnProfile('userX')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// updateConsultant — 404 guard
// ---------------------------------------------------------------------------

describe('updateConsultant', () => {
  it('throws 404 when the consultant does not exist', async () => {
    mockRepo.findConsultantById.mockResolvedValue(null);
    await expect(
      service.updateConsultant('missing', { bio: 'x' }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockRepo.updateConsultant).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Schema-level: PATCH /me body with `position` is rejected by .strict()
// ---------------------------------------------------------------------------

describe('UpdateOwnProfileBodySchema .strict()', () => {
  it('rejects a body containing the admin-only `position` field', () => {
    const parsed = UpdateOwnProfileBodySchema.safeParse({
      bio: 'ok',
      position: 'Lead Engineer',
    });
    expect(parsed.success).toBe(false);
  });
});
