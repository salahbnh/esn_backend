import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the repository. The service is tested in isolation — no DB, no network.
vi.mock('./reporting.repository.js');
// Stub the logger so importing the service (transitively) doesn't pull in the
// env-validating config module (which calls process.exit on missing env).
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './reporting.repository.js';
import * as service from './reporting.service.js';

const mockRepo = vi.mocked(repo);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

describe('getOccupancy', () => {
  it('returns 0 avg and empty buckets when there are no consultants', async () => {
    mockRepo.consultantCountsByStatus.mockResolvedValue([]);
    mockRepo.activeAllocationSumsByConsultant.mockResolvedValue([]);
    mockRepo.totalConsultants.mockResolvedValue(0);

    const result = await service.getOccupancy();

    expect(result.globalAvgAllocationPct).toBe(0);
    expect(result.totalConsultants).toBe(0);
    expect(result.consultantsByStatus).toEqual({
      ON_MISSION: 0,
      INTERCONTRAT: 0,
      AVAILABLE: 0,
    });
    expect(result.distribution).toEqual({ full: 0, partial: 0, unassigned: 0 });
  });

  it('computes company-wide avg incl. idle consultants and buckets full/partial/unassigned', async () => {
    // 1 full (100), 1 partial (50), 1 unassigned (0) -> avg = 150/3 = 50.
    mockRepo.consultantCountsByStatus.mockResolvedValue([
      { status: 'ON_MISSION', count: 2 },
      { status: 'INTERCONTRAT', count: 1 },
    ]);
    mockRepo.activeAllocationSumsByConsultant.mockResolvedValue([
      { consultantId: 'c1', sumAllocationPct: 100 },
      { consultantId: 'c2', sumAllocationPct: 50 },
    ]);
    mockRepo.totalConsultants.mockResolvedValue(3);

    const result = await service.getOccupancy();

    expect(result.globalAvgAllocationPct).toBe(50);
    expect(result.totalConsultants).toBe(3);
    expect(result.consultantsByStatus).toEqual({
      ON_MISSION: 2,
      INTERCONTRAT: 1,
      AVAILABLE: 0,
    });
    expect(result.distribution).toEqual({ full: 1, partial: 1, unassigned: 1 });
  });

  it('idle consultants drag the average down (rounds to 1 decimal)', async () => {
    // 100 across 3 consultants -> 33.333 -> 33.3.
    mockRepo.consultantCountsByStatus.mockResolvedValue([{ status: 'ON_MISSION', count: 1 }]);
    mockRepo.activeAllocationSumsByConsultant.mockResolvedValue([
      { consultantId: 'c1', sumAllocationPct: 100 },
    ]);
    mockRepo.totalConsultants.mockResolvedValue(3);

    const result = await service.getOccupancy();

    expect(result.globalAvgAllocationPct).toBe(33.3);
    expect(result.distribution).toEqual({ full: 1, partial: 0, unassigned: 2 });
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe('getPipeline', () => {
  it('fills missing candidate statuses with 0 and echoes the window', async () => {
    mockRepo.candidateCountsByStatus.mockResolvedValue([
      { status: 'APPLIED', count: 5 },
      { status: 'INTERVIEW', count: 2 },
    ]);

    const result = await service.getPipeline({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    });

    expect(result.funnel).toEqual({
      APPLIED: 5,
      INTERVIEW: 2,
      VALIDATED: 0,
      REJECTED: 0,
      HIRED: 0,
    });
    expect(result.total).toBe(7);
    expect(result.from).toBe('2026-01-01T00:00:00.000Z');
    expect(result.to).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns null window fields and total 0 when no filter supplied', async () => {
    mockRepo.candidateCountsByStatus.mockResolvedValue([]);
    const result = await service.getPipeline({});
    expect(result.from).toBeNull();
    expect(result.to).toBeNull();
    expect(result.funnel.HIRED).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

describe('getMissions', () => {
  it('returns null avg duration when no CLOSED missions and derives activeCount/forecast/total', async () => {
    mockRepo.missionCountsByStatus.mockResolvedValue([
      { status: 'IN_PROGRESS', count: 4 },
      { status: 'STAFFED', count: 2 },
    ]);
    mockRepo.missionForecastCount.mockResolvedValue(2);
    mockRepo.avgMissionDurationDays.mockResolvedValue(null);

    const result = await service.getMissions({});

    expect(result.avgDurationDays).toBeNull();
    expect(result.activeCount).toBe(4);
    expect(result.forecastCount).toBe(2);
    expect(result.totalMissions).toBe(6);
    expect(result.byStatus).toEqual({
      DRAFT: 0,
      STAFFED: 2,
      IN_PROGRESS: 4,
      CLOSED: 0,
      ARCHIVED: 0,
    });
  });

  it('rounds avg duration to 1 decimal and totals all statuses', async () => {
    mockRepo.missionCountsByStatus.mockResolvedValue([
      { status: 'CLOSED', count: 3 },
      { status: 'ARCHIVED', count: 1 },
    ]);
    mockRepo.missionForecastCount.mockResolvedValue(0);
    mockRepo.avgMissionDurationDays.mockResolvedValue(87.456);

    const result = await service.getMissions({});

    expect(result.avgDurationDays).toBe(87.5);
    expect(result.activeCount).toBe(0);
    expect(result.totalMissions).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

describe('getHr', () => {
  it('derives intercontratCount and fills contract statuses', async () => {
    mockRepo.consultantCountsByStatus.mockResolvedValue([
      { status: 'INTERCONTRAT', count: 3 },
      { status: 'ON_MISSION', count: 7 },
    ]);
    mockRepo.contractCountsByStatus.mockResolvedValue([{ status: 'SIGNED', count: 9 }]);
    mockRepo.totalConsultants.mockResolvedValue(10);

    const result = await service.getHr();

    expect(result.intercontratCount).toBe(3);
    expect(result.headcount.total).toBe(10);
    expect(result.headcount.byStatus).toEqual({
      ON_MISSION: 7,
      INTERCONTRAT: 3,
      AVAILABLE: 0,
    });
    expect(result.contractsByStatus).toEqual({
      DRAFT: 0,
      INTERNAL_VALIDATION: 0,
      PENDING_SIGNATURE: 0,
      SIGNED: 9,
      ARCHIVED: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Summary — role filtering (D2)
// ---------------------------------------------------------------------------

describe('getSummary', () => {
  function stubAllRepos() {
    mockRepo.consultantCountsByStatus.mockResolvedValue([]);
    mockRepo.activeAllocationSumsByConsultant.mockResolvedValue([]);
    mockRepo.totalConsultants.mockResolvedValue(0);
    mockRepo.missionCountsByStatus.mockResolvedValue([]);
    mockRepo.missionForecastCount.mockResolvedValue(0);
    mockRepo.avgMissionDurationDays.mockResolvedValue(null);
    mockRepo.candidateCountsByStatus.mockResolvedValue([]);
    mockRepo.contractCountsByStatus.mockResolvedValue([]);
  }

  it('MANAGER gets ONLY occupancy + missions (no pipeline, no hr)', async () => {
    stubAllRepos();
    const result = await service.getSummary('MANAGER');

    expect(result.occupancy).toBeDefined();
    expect(result.missions).toBeDefined();
    expect('pipeline' in result).toBe(false);
    expect('hr' in result).toBe(false);
    expect(mockRepo.candidateCountsByStatus).not.toHaveBeenCalled();
    expect(mockRepo.contractCountsByStatus).not.toHaveBeenCalled();
  });

  it('RH gets all four blocks', async () => {
    stubAllRepos();
    const result = await service.getSummary('RH');

    expect(result.occupancy).toBeDefined();
    expect(result.missions).toBeDefined();
    expect(result.pipeline).toBeDefined();
    expect(result.hr).toBeDefined();
  });

  it('DIRECTION gets all four blocks', async () => {
    stubAllRepos();
    const result = await service.getSummary('DIRECTION');

    expect(result.pipeline).toBeDefined();
    expect(result.hr).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// /me — ownership
// ---------------------------------------------------------------------------

describe('getMe', () => {
  it('throws 404 when no consultant profile exists for the userId', async () => {
    mockRepo.findConsultantByUserId.mockResolvedValue(null);

    await expect(service.getMe('user-without-profile')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockRepo.activeAssignmentsForConsultant).not.toHaveBeenCalled();
  });

  it('sums allocation, counts assignments, and maps mission summaries with ISO dates', async () => {
    mockRepo.findConsultantByUserId.mockResolvedValue({ id: 'cons1' });
    mockRepo.activeAssignmentsForConsultant.mockResolvedValue([
      {
        allocationPct: 50,
        missionId: 'm1',
        project: 'CRM',
        clientName: 'Acme',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        endDate: new Date('2026-09-30T00:00:00.000Z'),
      },
      {
        allocationPct: 30,
        missionId: 'm2',
        project: 'ERP',
        clientName: 'Globex',
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: null,
      },
    ]);

    const result = await service.getMe('user1');

    expect(result.consultantId).toBe('cons1');
    expect(result.activeAllocationPct).toBe(80);
    expect(result.activeAssignmentsCount).toBe(2);
    expect(result.activeMissions).toHaveLength(2);
    expect(result.activeMissions[0]).toEqual({
      missionId: 'm1',
      project: 'CRM',
      clientName: 'Acme',
      allocationPct: 50,
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
    });
    expect(result.activeMissions[1]?.endDate).toBeNull();
  });
});
