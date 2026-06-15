import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, AssignmentStatus } from '@prisma/client';

// Mock every collaborator: the staffing repo, the two cross-module services,
// the prisma client ($transaction), and the logger (so importing the service
// transitively doesn't pull in the env-validating config module).
vi.mock('./staffing.repository.js');
vi.mock('../missions/missions.service.js');
vi.mock('../consultants/consultants.service.js');
vi.mock('../../lib/prisma.js', () => ({
  // $transaction invokes its callback with a fake tx object.
  prisma: { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})) },
}));
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './staffing.repository.js';
import * as missionsService from '../missions/missions.service.js';
import * as consultantsService from '../consultants/consultants.service.js';
import * as service from './staffing.service.js';

const mockRepo = vi.mocked(repo);
const mockMissions = vi.mocked(missionsService);
const mockConsultants = vi.mocked(consultantsService);

function assignment(overrides: Record<string, unknown> = {}): Assignment {
  return {
    id: 'asg1',
    missionId: 'mis1',
    consultantId: 'con1',
    roleOnMission: null,
    startDate: new Date(),
    endDate: null,
    allocationPct: 100,
    status: 'PROPOSED',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Assignment;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
  mockRepo.updateAssignmentStatusTx.mockImplementation(
    async (id: string, status: AssignmentStatus) => assignment({ id, status }),
  );
  mockMissions.setMissionStaffed.mockResolvedValue(undefined);
  mockConsultants.setConsultantOnMission.mockResolvedValue(undefined);
  mockConsultants.setConsultantIntercontratIfIdle.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

describe('changeAssignmentStatus — state machine', () => {
  it('PROPOSED -> CONFIRMED succeeds (simple update, no cascade)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'PROPOSED' }));
    const result = await service.changeAssignmentStatus(
      'asg1',
      'CONFIRMED',
      undefined,
      false,
      'actor1',
    );
    expect(result.status).toBe('CONFIRMED');
    expect(mockRepo.updateAssignmentStatusTx).toHaveBeenCalledWith('asg1', 'CONFIRMED');
    expect(mockMissions.setMissionStaffed).not.toHaveBeenCalled();
    expect(mockConsultants.setConsultantOnMission).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STATUS_CHANGE', entityType: 'ASSIGNMENT' }),
    );
  });

  it('CONFIRMED -> PROPOSED succeeds (de-confirm)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'CONFIRMED' }));
    const result = await service.changeAssignmentStatus(
      'asg1',
      'PROPOSED',
      undefined,
      false,
      'actor1',
    );
    expect(result.status).toBe('PROPOSED');
  });

  it('CONFIRMED -> ACTIVE succeeds and drives mission + consultant hooks', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'CONFIRMED', allocationPct: 50 }),
    );
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(0);
    const result = await service.changeAssignmentStatus(
      'asg1',
      'ACTIVE',
      undefined,
      false,
      'actor1',
    );
    expect(result.status).toBe('ACTIVE');
    expect(mockMissions.setMissionStaffed).toHaveBeenCalledWith('mis1', 'actor1', {});
    expect(mockConsultants.setConsultantOnMission).toHaveBeenCalledWith(
      'con1',
      'actor1',
      {},
    );
  });

  it('ACTIVE -> ENDED succeeds and calls setConsultantIntercontratIfIdle', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'ACTIVE' }));
    const result = await service.changeAssignmentStatus(
      'asg1',
      'ENDED',
      undefined,
      false,
      'actor1',
    );
    expect(result.status).toBe('ENDED');
    expect(mockConsultants.setConsultantIntercontratIfIdle).toHaveBeenCalledWith(
      'con1',
      'actor1',
      {},
    );
    // Mission is NOT changed on ENDED.
    expect(mockMissions.setMissionStaffed).not.toHaveBeenCalled();
  });

  it('PROPOSED -> ACTIVE throws INVALID_TRANSITION (must pass CONFIRMED)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'PROPOSED' }));
    await expect(
      service.changeAssignmentStatus('asg1', 'ACTIVE', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_TRANSITION' } });
    expect(mockRepo.updateAssignmentStatusTx).not.toHaveBeenCalled();
  });

  it('ENDED -> PROPOSED throws 400 (terminal)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'ENDED' }));
    await expect(
      service.changeAssignmentStatus('asg1', 'PROPOSED', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('ACTIVE -> ACTIVE (same state) throws 400', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'ACTIVE' }));
    await expect(
      service.changeAssignmentStatus('asg1', 'ACTIVE', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_TRANSITION' } });
  });

  it('throws 404 when the assignment does not exist', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(null);
    await expect(
      service.changeAssignmentStatus('missing', 'CONFIRMED', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rolls back when the mission hook throws on activation (e.g. mission CLOSED)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(assignment({ status: 'CONFIRMED' }));
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(0);
    mockMissions.setMissionStaffed.mockRejectedValue(
      Object.assign(new Error('closed'), { statusCode: 400 }),
    );
    await expect(
      service.changeAssignmentStatus('asg1', 'ACTIVE', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    // The consultant hook must not run after the mission hook throws.
    expect(mockConsultants.setConsultantOnMission).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Over-allocation guard on activation (→ ACTIVE)
// ---------------------------------------------------------------------------

describe('over-allocation guard on activation', () => {
  it('rejects when other ACTIVE sum + this allocation > 100', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'CONFIRMED', allocationPct: 30 }),
    );
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(80);
    await expect(
      service.changeAssignmentStatus('asg1', 'ACTIVE', undefined, false, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'OVER_ALLOCATED' } });
    expect(mockRepo.updateAssignmentStatusTx).not.toHaveBeenCalled();
  });

  it('allows exactly 100 (80 + 20)', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'CONFIRMED', allocationPct: 20 }),
    );
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(80);
    const result = await service.changeAssignmentStatus(
      'asg1',
      'ACTIVE',
      undefined,
      false,
      'actor1',
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('force:true bypasses the over-allocation guard', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'CONFIRMED', allocationPct: 60 }),
    );
    const result = await service.changeAssignmentStatus(
      'asg1',
      'ACTIVE',
      undefined,
      true,
      'actor1',
    );
    expect(result.status).toBe('ACTIVE');
    // The capacity read is skipped entirely when force is set.
    expect(mockRepo.getConsultantActiveAllocationPct).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Over-allocation guard on allocationPct edit of an ACTIVE assignment
// ---------------------------------------------------------------------------

describe('over-allocation guard on allocationPct edit (ACTIVE)', () => {
  it('rejects when others (excluding self) + new > 100', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'ACTIVE', allocationPct: 20 }),
    );
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(70); // others, excluding self
    await expect(
      service.updateAssignment('asg1', { allocationPct: 50 }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'OVER_ALLOCATED' } });
    // The exclude-self id must be passed to the capacity read.
    expect(mockRepo.getConsultantActiveAllocationPct).toHaveBeenCalledWith('con1', 'asg1');
    expect(mockRepo.updateAssignment).not.toHaveBeenCalled();
  });

  it('allows when within capacity', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'ACTIVE', allocationPct: 20 }),
    );
    mockRepo.getConsultantActiveAllocationPct.mockResolvedValue(50);
    mockRepo.updateAssignment.mockResolvedValue(
      assignment({ status: 'ACTIVE', allocationPct: 40 }) as unknown as Awaited<
        ReturnType<typeof repo.updateAssignment>
      >,
    );
    await service.updateAssignment('asg1', { allocationPct: 40 }, 'actor1');
    expect(mockRepo.updateAssignment).toHaveBeenCalled();
  });

  it('force:true bypasses the edit guard', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'ACTIVE', allocationPct: 20 }),
    );
    mockRepo.updateAssignment.mockResolvedValue(
      assignment({ status: 'ACTIVE', allocationPct: 90 }) as unknown as Awaited<
        ReturnType<typeof repo.updateAssignment>
      >,
    );
    await service.updateAssignment('asg1', { allocationPct: 90, force: true }, 'actor1');
    expect(mockRepo.getConsultantActiveAllocationPct).not.toHaveBeenCalled();
    expect(mockRepo.updateAssignment).toHaveBeenCalled();
  });

  it('does NOT run the guard for a non-ACTIVE assignment edit', async () => {
    mockRepo.findAssignmentById.mockResolvedValue(
      assignment({ status: 'PROPOSED', allocationPct: 20 }),
    );
    mockRepo.updateAssignment.mockResolvedValue(
      assignment({ status: 'PROPOSED', allocationPct: 90 }) as unknown as Awaited<
        ReturnType<typeof repo.updateAssignment>
      >,
    );
    await service.updateAssignment('asg1', { allocationPct: 90 }, 'actor1');
    expect(mockRepo.getConsultantActiveAllocationPct).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Create — mission state guards
// ---------------------------------------------------------------------------

describe('createAssignment', () => {
  const body = {
    missionId: 'mis1',
    consultantId: 'con1',
    startDate: new Date().toISOString(),
    allocationPct: 100,
  };

  it('creates a PROPOSED assignment without a capacity check', async () => {
    mockMissions.getMissionStatusOrNull.mockResolvedValue('DRAFT');
    mockConsultants.consultantExists.mockResolvedValue(true);
    mockRepo.createAssignment.mockResolvedValue(
      assignment({ status: 'PROPOSED' }) as unknown as Awaited<
        ReturnType<typeof repo.createAssignment>
      >,
    );
    const result = await service.createAssignment(body, 'actor1');
    expect(result).toMatchObject({ status: 'PROPOSED' });
    expect(mockRepo.getConsultantActiveAllocationPct).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'ASSIGNMENT' }),
    );
  });

  it('rejects when the mission is CLOSED', async () => {
    mockMissions.getMissionStatusOrNull.mockResolvedValue('CLOSED');
    await expect(service.createAssignment(body, 'actor1')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'MISSION_NOT_STAFFABLE' },
    });
    expect(mockRepo.createAssignment).not.toHaveBeenCalled();
  });

  it('rejects when the mission is ARCHIVED', async () => {
    mockMissions.getMissionStatusOrNull.mockResolvedValue('ARCHIVED');
    await expect(service.createAssignment(body, 'actor1')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'MISSION_NOT_STAFFABLE' },
    });
  });

  it('404 when the mission does not exist', async () => {
    mockMissions.getMissionStatusOrNull.mockResolvedValue(null);
    await expect(service.createAssignment(body, 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('404 when the consultant does not exist', async () => {
    mockMissions.getMissionStatusOrNull.mockResolvedValue('DRAFT');
    mockConsultants.consultantExists.mockResolvedValue(false);
    await expect(service.createAssignment(body, 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// Suggestions — ordering
// ---------------------------------------------------------------------------

describe('suggestConsultantsForMission', () => {
  it('orders by matchCount DESC then currentAllocationPct ASC', async () => {
    mockRepo.findMissionRequiredSkillIds.mockResolvedValue(['s1', 's2', 's3']);
    mockRepo.findAvailableConsultantsForMission.mockResolvedValue([
      {
        consultant: { id: 'a', status: 'AVAILABLE', firstName: 'A', lastName: 'A' },
        matchCount: 1,
        currentAllocationPct: 0,
        matchedSkills: [{ id: 's1', name: 'x' }],
      },
      {
        consultant: { id: 'b', status: 'AVAILABLE', firstName: 'B', lastName: 'B' },
        matchCount: 3,
        currentAllocationPct: 50,
        matchedSkills: [],
      },
      {
        consultant: { id: 'c', status: 'AVAILABLE', firstName: 'C', lastName: 'C' },
        matchCount: 3,
        currentAllocationPct: 20,
        matchedSkills: [],
      },
    ]);
    const result = await service.suggestConsultantsForMission({
      missionId: 'mis1',
      page: 1,
      pageSize: 20,
    });
    expect(result.data.map((d) => d.consultant.id)).toEqual(['c', 'b', 'a']);
    expect(result.total).toBe(3);
  });

  it('404 when the mission does not exist', async () => {
    mockRepo.findMissionRequiredSkillIds.mockResolvedValue(null);
    await expect(
      service.suggestConsultantsForMission({ missionId: 'mis1', page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
