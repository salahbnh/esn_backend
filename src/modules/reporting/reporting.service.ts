import type {
  CandidateStatus,
  ConsultantStatus,
  ContractStatus,
  MissionStatus,
  Role,
} from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './reporting.repository.js';
import type { StatusCount } from './reporting.repository.js';
import type {
  HrReport,
  MissionsReport,
  OccupancyReport,
  OwnDashboard,
  PipelineReport,
  ReportWindowQuery,
  SummaryReport,
} from './reporting.schema.js';

/**
 * Reporting business logic: orchestrates repository reads and derives the
 * computed KPI shapes. No Prisma here (repository is the only DB layer), no
 * audit (read-only), no transactions.
 */

const CONSULTANT_STATUSES: ConsultantStatus[] = ['ON_MISSION', 'INTERCONTRAT', 'AVAILABLE'];
const CANDIDATE_STATUSES: CandidateStatus[] = [
  'APPLIED',
  'INTERVIEW',
  'VALIDATED',
  'REJECTED',
  'HIRED',
];
const MISSION_STATUSES: MissionStatus[] = [
  'DRAFT',
  'STAFFED',
  'IN_PROGRESS',
  'CLOSED',
  'ARCHIVED',
];
const CONTRACT_STATUSES: ContractStatus[] = [
  'DRAFT',
  'INTERNAL_VALIDATION',
  'PENDING_SIGNATURE',
  'SIGNED',
  'ARCHIVED',
];

/** Build a complete count record over `keys`, defaulting missing statuses to 0. */
function fillCounts<S extends string>(rows: StatusCount<S>[], keys: S[]): Record<S, number> {
  const result = {} as Record<S, number>;
  for (const key of keys) {
    result[key] = 0;
  }
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

/** Sum all values of a count record. */
function sumCounts<S extends string>(counts: Record<S, number>): number {
  return Object.values<number>(counts).reduce((acc, n) => acc + n, 0);
}

/** Round to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Convert an optional window query into Date objects for the repository. */
function toWindow(query: ReportWindowQuery): { from?: Date; to?: Date } {
  return {
    ...(query.from !== undefined ? { from: new Date(query.from) } : {}),
    ...(query.to !== undefined ? { to: new Date(query.to) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export async function getOccupancy(): Promise<OccupancyReport> {
  const [byStatusRows, allocSums, total] = await Promise.all([
    repo.consultantCountsByStatus(),
    repo.activeAllocationSumsByConsultant(),
    repo.totalConsultants(),
  ]);

  const consultantsByStatus = fillCounts(byStatusRows, CONSULTANT_STATUSES);

  // Company-wide utilization (D7): SUM(active allocationPct per consultant) /
  // totalConsultants. Consultants with no ACTIVE assignment count as 0%.
  const totalAlloc = allocSums.reduce((acc, c) => acc + c.sumAllocationPct, 0);
  const globalAvgAllocationPct = total === 0 ? 0 : round1(totalAlloc / total);

  // Distribution buckets. Consultants absent from `allocSums` have 0% (unassigned).
  let full = 0;
  let partial = 0;
  for (const c of allocSums) {
    if (c.sumAllocationPct >= 100) {
      full += 1;
    } else if (c.sumAllocationPct >= 1) {
      partial += 1;
    }
    // sum of 0 (or negative, impossible) falls through — counted as unassigned below.
  }
  const withActive = full + partial;
  const unassigned = Math.max(0, total - withActive);

  return {
    globalAvgAllocationPct,
    consultantsByStatus,
    totalConsultants: total,
    distribution: { full, partial, unassigned },
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function getPipeline(query: ReportWindowQuery): Promise<PipelineReport> {
  const window = toWindow(query);
  const rows = await repo.candidateCountsByStatus(window);
  const funnel = fillCounts(rows, CANDIDATE_STATUSES);
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    funnel,
    total: sumCounts(funnel),
  };
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export async function getMissions(query: ReportWindowQuery): Promise<MissionsReport> {
  const window = toWindow(query);
  const now = new Date();

  const [byStatusRows, forecastCount, avgDuration] = await Promise.all([
    repo.missionCountsByStatus(window),
    repo.missionForecastCount(now, window),
    repo.avgMissionDurationDays(window),
  ]);

  const byStatus = fillCounts(byStatusRows, MISSION_STATUSES);

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    byStatus,
    activeCount: byStatus.IN_PROGRESS,
    forecastCount,
    avgDurationDays: avgDuration === null ? null : round1(avgDuration),
    totalMissions: sumCounts(byStatus),
  };
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export async function getHr(): Promise<HrReport> {
  const [consultantRows, contractRows, total] = await Promise.all([
    repo.consultantCountsByStatus(),
    repo.contractCountsByStatus(),
    repo.totalConsultants(),
  ]);

  const byStatus = fillCounts(consultantRows, CONSULTANT_STATUSES);

  return {
    headcount: {
      total,
      byStatus,
    },
    intercontratCount: byStatus.INTERCONTRAT,
    contractsByStatus: fillCounts(contractRows, CONTRACT_STATUSES),
  };
}

// ---------------------------------------------------------------------------
// Summary (role-filtered per D2)
// ---------------------------------------------------------------------------

export async function getSummary(role: Role): Promise<SummaryReport> {
  // MANAGER sees OPERATIONAL reports only: occupancy + missions. No pipeline/hr.
  if (role === 'MANAGER') {
    const [occupancy, missions] = await Promise.all([getOccupancy(), getMissions({})]);
    return { occupancy, missions };
  }

  // RH / DIRECTION get the full snapshot.
  const [occupancy, missions, pipeline, hr] = await Promise.all([
    getOccupancy(),
    getMissions({}),
    getPipeline({}),
    getHr(),
  ]);
  return { occupancy, missions, pipeline, hr };
}

// ---------------------------------------------------------------------------
// CONSULTANT own dashboard
// ---------------------------------------------------------------------------

export async function getMe(userId: string): Promise<OwnDashboard> {
  const consultant = await repo.findConsultantByUserId(userId);
  if (!consultant) {
    throw AppError.notFound('Consultant profile not found');
  }

  const assignments = await repo.activeAssignmentsForConsultant(consultant.id);
  const activeAllocationPct = assignments.reduce((acc, a) => acc + a.allocationPct, 0);

  return {
    consultantId: consultant.id,
    activeAllocationPct,
    activeAssignmentsCount: assignments.length,
    activeMissions: assignments.map((a) => ({
      missionId: a.missionId,
      project: a.project,
      clientName: a.clientName,
      allocationPct: a.allocationPct,
      startDate: a.startDate ? a.startDate.toISOString() : null,
      endDate: a.endDate ? a.endDate.toISOString() : null,
    })),
  };
}
