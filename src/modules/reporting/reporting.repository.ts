import {
  Prisma,
  type CandidateStatus,
  type ConsultantStatus,
  type ContractStatus,
  type MissionStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Reporting data-access layer. The ONLY reporting-module file that imports the
 * Prisma client. Read-only — no mutations, no audit, no transactions.
 *
 * Reporting is an inherently cross-cutting read aggregator: it reads tables
 * owned by other modules (Consultant, Assignment, Candidate, Mission, Contract)
 * directly, but never calls another module's service/repository (keeps the
 * service-layer dependency graph acyclic).
 *
 * Each function returns typed, narrow data; the service shapes the response.
 */

export interface StatusCount<S extends string> {
  status: S;
  count: number;
}

export interface ConsultantAllocationSum {
  consultantId: string;
  sumAllocationPct: number;
}

export interface OwnActiveAssignment {
  allocationPct: number;
  missionId: string;
  project: string;
  clientName: string;
  startDate: Date | null;
  endDate: Date | null;
}

interface DateWindow {
  from?: Date;
  to?: Date;
}

/** Build a Prisma date-range filter from an optional window, or undefined. */
function dateRange(window: DateWindow): Prisma.DateTimeFilter | undefined {
  if (window.from === undefined && window.to === undefined) {
    return undefined;
  }
  return {
    ...(window.from !== undefined ? { gte: window.from } : {}),
    ...(window.to !== undefined ? { lte: window.to } : {}),
  };
}

// ---------------------------------------------------------------------------
// Occupancy + HR (consultants / assignments / contracts)
// ---------------------------------------------------------------------------

/** Consultant headcount grouped by status. */
export async function consultantCountsByStatus(): Promise<StatusCount<ConsultantStatus>[]> {
  const rows = await prisma.consultant.groupBy({
    by: ['status'],
    _count: true,
  });
  return rows.map((r) => ({ status: r.status, count: r._count }));
}

/** Total consultant headcount (denominator for the company-wide occupancy). */
export async function totalConsultants(): Promise<number> {
  return prisma.consultant.count();
}

/**
 * Sum of ACTIVE `allocationPct` per consultant (only consultants with at least
 * one ACTIVE assignment appear). Consultants absent from this list have 0%.
 */
export async function activeAllocationSumsByConsultant(): Promise<ConsultantAllocationSum[]> {
  const rows = await prisma.assignment.groupBy({
    by: ['consultantId'],
    where: { status: 'ACTIVE' },
    _sum: { allocationPct: true },
  });
  return rows.map((r) => ({
    consultantId: r.consultantId,
    sumAllocationPct: r._sum.allocationPct ?? 0,
  }));
}

/** Contract counts grouped by status (excludes archived). */
export async function contractCountsByStatus(): Promise<StatusCount<ContractStatus>[]> {
  const rows = await prisma.contract.groupBy({
    by: ['status'],
    _count: true,
    where: { archivedAt: null },
  });
  return rows.map((r) => ({ status: r.status, count: r._count }));
}

// ---------------------------------------------------------------------------
// Pipeline (candidates)
// ---------------------------------------------------------------------------

/** Candidate counts grouped by status, optionally windowed on `createdAt`. */
export async function candidateCountsByStatus(
  window: DateWindow = {},
): Promise<StatusCount<CandidateStatus>[]> {
  const createdAt = dateRange(window);
  const rows = await prisma.candidate.groupBy({
    by: ['status'],
    _count: true,
    ...(createdAt !== undefined ? { where: { createdAt } } : {}),
  });
  return rows.map((r) => ({ status: r.status, count: r._count }));
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

/**
 * Mission counts grouped by status, windowed on startDate. Includes ARCHIVED
 * missions — the status breakdown must be complete (the fill list covers
 * ARCHIVED). Forecast (`missionForecastCount`) still excludes archived.
 */
export async function missionCountsByStatus(
  window: DateWindow = {},
): Promise<StatusCount<MissionStatus>[]> {
  const startDate = dateRange(window);
  const rows = await prisma.mission.groupBy({
    by: ['status'],
    _count: true,
    ...(startDate !== undefined ? { where: { startDate } } : {}),
  });
  return rows.map((r) => ({ status: r.status, count: r._count }));
}

/** Count of STAFFED missions starting in the future (forecast), windowed. */
export async function missionForecastCount(now: Date, window: DateWindow = {}): Promise<number> {
  const lower = window.from !== undefined && window.from > now ? window.from : now;
  return prisma.mission.count({
    where: {
      status: 'STAFFED',
      archivedAt: null,
      startDate: {
        gt: lower,
        ...(window.to !== undefined ? { lte: window.to } : {}),
      },
    },
  });
}

/**
 * Average duration (in days) of CLOSED missions with a non-null endDate.
 *
 * Prisma cannot `_avg` a DateTime interval, so this is the ONE raw query in the
 * module. It is fully parameterized via `Prisma.sql` tagged templates — no user
 * input is string-interpolated. Returns null when there are no qualifying rows.
 */
export async function avgMissionDurationDays(window: DateWindow = {}): Promise<number | null> {
  const fromClause =
    window.from !== undefined ? Prisma.sql`AND "startDate" >= ${window.from}` : Prisma.empty;
  const toClause =
    window.to !== undefined ? Prisma.sql`AND "startDate" <= ${window.to}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ avg_days: number | null }>>(Prisma.sql`
    SELECT AVG(EXTRACT(EPOCH FROM ("endDate" - "startDate")) / 86400.0)::float AS avg_days
    FROM "Mission"
    WHERE status = 'CLOSED'
      AND "endDate" IS NOT NULL
      ${fromClause}
      ${toClause}
  `);
  return rows[0]?.avg_days ?? null;
}

// ---------------------------------------------------------------------------
// CONSULTANT own dashboard
// ---------------------------------------------------------------------------

/** Resolve the consultant id owned by `userId` (ownership anchor). */
export async function findConsultantByUserId(userId: string): Promise<{ id: string } | null> {
  return prisma.consultant.findUnique({
    where: { userId },
    select: { id: true },
  });
}

/** ACTIVE assignments for one consultant, with mission + client summary. */
export async function activeAssignmentsForConsultant(
  consultantId: string,
): Promise<OwnActiveAssignment[]> {
  const rows = await prisma.assignment.findMany({
    where: { consultantId, status: 'ACTIVE' },
    select: {
      allocationPct: true,
      startDate: true,
      endDate: true,
      mission: {
        select: {
          id: true,
          project: true,
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  });
  return rows.map((r) => ({
    allocationPct: r.allocationPct,
    missionId: r.mission.id,
    project: r.mission.project,
    clientName: r.mission.client.name,
    startDate: r.startDate,
    endDate: r.endDate,
  }));
}
