import { z } from 'zod';

/**
 * Zod schemas + response payload types for the Reporting module.
 *
 * Reporting is READ-ONLY: there are no write bodies. Query schemas are NOT
 * `.strict()` (per prior reviews — GET query strings may carry innocuous extra
 * keys). Response payload shapes are TypeScript interfaces (no runtime output
 * validation); the service returns these concrete types.
 */

// ---------------------------------------------------------------------------
// Query schemas (NOT strict)
// ---------------------------------------------------------------------------

/**
 * Shared date-window query params for `pipeline` and `missions`. Both optional;
 * when both are present, `from` must not be after `to`. ISO-8601 strings.
 */
export const ReportWindowQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine((d) => !(d.from !== undefined && d.to !== undefined && new Date(d.from) > new Date(d.to)), {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type ReportWindowQuery = z.infer<typeof ReportWindowQuerySchema>;

/**
 * Query schema for the zero-param endpoints (`/occupancy`, `/hr`, `/summary`,
 * `/me`). These accept NO query params — strict-empty rejects any unknown key
 * with a 400. (This intentionally differs from list endpoints' non-strict query
 * schemas: those genuinely accept optional params; these accept none.)
 */
export const EmptyQuerySchema = z.object({}).strict();

// ---------------------------------------------------------------------------
// Response payload types
// ---------------------------------------------------------------------------

export interface OccupancyReport {
  globalAvgAllocationPct: number;
  consultantsByStatus: Record<'ON_MISSION' | 'INTERCONTRAT' | 'AVAILABLE', number>;
  totalConsultants: number;
  distribution: { full: number; partial: number; unassigned: number };
}

export interface PipelineReport {
  from: string | null;
  to: string | null;
  funnel: Record<'APPLIED' | 'INTERVIEW' | 'VALIDATED' | 'REJECTED' | 'HIRED', number>;
  total: number;
}

export interface MissionsReport {
  from: string | null;
  to: string | null;
  byStatus: Record<'DRAFT' | 'STAFFED' | 'IN_PROGRESS' | 'CLOSED' | 'ARCHIVED', number>;
  activeCount: number;
  forecastCount: number;
  avgDurationDays: number | null;
  totalMissions: number;
}

export interface HrReport {
  headcount: {
    total: number;
    byStatus: Record<'ON_MISSION' | 'INTERCONTRAT' | 'AVAILABLE', number>;
  };
  intercontratCount: number;
  contractsByStatus: Record<
    'DRAFT' | 'INTERNAL_VALIDATION' | 'PENDING_SIGNATURE' | 'SIGNED' | 'ARCHIVED',
    number
  >;
}

export interface SummaryReport {
  occupancy: OccupancyReport;
  missions: MissionsReport;
  pipeline?: PipelineReport; // omitted for MANAGER (D2)
  hr?: HrReport; // omitted for MANAGER (D2)
}

export interface OwnDashboard {
  consultantId: string;
  activeAllocationPct: number;
  activeAssignmentsCount: number;
  activeMissions: Array<{
    missionId: string;
    project: string;
    clientName: string;
    allocationPct: number;
    startDate: string | null;
    endDate: string | null;
  }>;
}
