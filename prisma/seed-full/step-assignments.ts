/**
 * Staffing: who works on what, plus mission amendments.
 *
 * The table below is written by hand rather than generated so the bench stays
 * COHERENT with `ConsultantStatus`: every ON_MISSION consultant has exactly one
 * ACTIVE assignment on an IN_PROGRESS mission, INTERCONTRAT profiles carry a
 * CONFIRMED assignment that has not started yet (or nothing at all), AVAILABLE
 * ones appear only as PROPOSED suggestions, and closed/archived missions keep
 * their ENDED history so occupancy reporting has a past to chart.
 */
import type { AssignmentStatus, Prisma, PrismaClient } from '@prisma/client';
import { sid, n2 } from './ids.js';
import { type Rng, days, int } from './rng.js';
import type { MissionsResult } from './step-missions.js';
import type { SeededConsultant } from './step-consultants.js';
import { staffOf, type StaffMap } from './step-users.js';

interface StaffingRow {
  /** 1-based mission index, matching the order in step-missions.ts. */
  mission: number;
  consultant: string;
  status: AssignmentStatus;
  role: string;
  allocation: number;
}

const STAFFING: readonly StaffingRow[] = [
  // --- ACTIVE: the 14 ON_MISSION consultants ------------------------------
  { mission: 1, consultant: 'c02', status: 'ACTIVE', role: 'Developpeuse Frontend', allocation: 100 },
  { mission: 2, consultant: 'c05', status: 'ACTIVE', role: 'Referent technique backend', allocation: 100 },
  { mission: 2, consultant: 'c14', status: 'ACTIVE', role: 'Developpeuse Backend', allocation: 100 },
  { mission: 4, consultant: 'c01', status: 'ACTIVE', role: 'Developpeur Full-Stack', allocation: 100 },
  { mission: 4, consultant: 'c06', status: 'ACTIVE', role: 'Business Analyst', allocation: 60 },
  { mission: 6, consultant: 'c11', status: 'ACTIVE', role: 'Ingenieur Cloud', allocation: 100 },
  { mission: 6, consultant: 'c03', status: 'ACTIVE', role: 'Ingenieur DevOps', allocation: 80 },
  { mission: 7, consultant: 'c09', status: 'ACTIVE', role: 'Developpeur Mobile', allocation: 100 },
  { mission: 9, consultant: 'c13', status: 'ACTIVE', role: 'Developpeur Full-Stack', allocation: 100 },
  { mission: 11, consultant: 'c07', status: 'ACTIVE', role: 'Architecte / Tech Lead', allocation: 100 },
  { mission: 13, consultant: 'c08', status: 'ACTIVE', role: 'Ingenieure QA', allocation: 70 },
  { mission: 15, consultant: 'c12', status: 'ACTIVE', role: 'Cheffe de projet', allocation: 100 },
  { mission: 17, consultant: 'c04', status: 'ACTIVE', role: 'Data Engineer', allocation: 100 },
  { mission: 17, consultant: 'c10', status: 'ACTIVE', role: 'Data Scientist', allocation: 50 },
  // --- CONFIRMED: intercontrat profiles already sold on a starting mission --
  { mission: 3, consultant: 'c15', status: 'CONFIRMED', role: 'Tech Lead', allocation: 100 },
  { mission: 12, consultant: 'c17', status: 'CONFIRMED', role: 'Consultant ERP / BI', allocation: 100 },
  { mission: 14, consultant: 'c19', status: 'CONFIRMED', role: 'Ingenieur Cybersecurite', allocation: 100 },
  // --- PROPOSED: staffing suggestions on missions still being scoped -------
  { mission: 8, consultant: 'c25', status: 'PROPOSED', role: 'Ingenieur DevOps', allocation: 100 },
  { mission: 19, consultant: 'c21', status: 'PROPOSED', role: 'Developpeur Backend', allocation: 100 },
  // --- ENDED: history on closed / archived missions ------------------------
  { mission: 5, consultant: 'c02', status: 'ENDED', role: 'Developpeuse Frontend', allocation: 100 },
  { mission: 5, consultant: 'c18', status: 'ENDED', role: 'Developpeuse Frontend', allocation: 100 },
  { mission: 10, consultant: 'c05', status: 'ENDED', role: 'Developpeur Backend', allocation: 100 },
  { mission: 18, consultant: 'c24', status: 'ENDED', role: 'Developpeuse Full-Stack', allocation: 100 },
  { mission: 16, consultant: 'c01', status: 'ENDED', role: 'Developpeur Full-Stack', allocation: 100 },
  { mission: 20, consultant: 'c08', status: 'ENDED', role: 'Ingenieure QA', allocation: 100 },
  { mission: 20, consultant: 'c16', status: 'ENDED', role: 'Ingenieure QA junior', allocation: 100 },
];

interface AmendmentRow {
  mission: number;
  reason: string;
  changes: Prisma.InputJsonValue;
  effectiveDaysFromNow: number;
  author: string;
}

const AMENDMENTS: readonly AmendmentRow[] = [
  { mission: 1, reason: "Prolongation de 3 mois demandee par le client", changes: { endDate: { before: '2026-07-31', after: '2026-10-31' } }, effectiveDaysFromNow: -30, author: 'mgr1' },
  { mission: 2, reason: 'Revalorisation du TJM apres negociation annuelle', changes: { tjm: { before: '650.00', after: '680.00' } }, effectiveDaysFromNow: -60, author: 'mgr2' },
  { mission: 4, reason: 'Ajout du lot "declaration en ligne" au perimetre', changes: { description: { before: 'Perimetre initial : gestion des sinistres', after: 'Perimetre etendu : gestion des sinistres + declaration en ligne' } }, effectiveDaysFromNow: -95, author: 'mgr1' },
  { mission: 6, reason: 'Decalage du demarrage du lot 2 (indisponibilite client)', changes: { startDate: { before: '2026-03-01', after: '2026-04-15' } }, effectiveDaysFromNow: -140, author: 'mgr3' },
  { mission: 11, reason: 'Passage de 1 a 2 consultants sur le lot encaissement', changes: { staffing: { before: '1 ETP', after: '2 ETP' } }, effectiveDaysFromNow: -75, author: 'mgr2' },
  { mission: 15, reason: 'Reduction du perimetre MES (report du module qualite)', changes: { description: { before: 'MES complet', after: 'MES hors module qualite' }, tjm: { before: '660.00', after: '640.00' } }, effectiveDaysFromNow: -50, author: 'mgr3' },
  { mission: 5, reason: 'Cloture anticipee a la demande du client', changes: { endDate: { before: '2026-01-31', after: '2025-12-15' }, status: { before: 'IN_PROGRESS', after: 'CLOSED' } }, effectiveDaysFromNow: -185, author: 'mgr1' },
  { mission: 17, reason: 'Renfort data science pour la phase de modelisation', changes: { staffing: { before: '1 data engineer', after: '1 data engineer + 0,5 data scientist' } }, effectiveDaysFromNow: -20, author: 'mgr2' },
];

export interface SeededAssignment {
  id: string;
  missionId: string;
  consultantId: string;
  role: string;
  status: AssignmentStatus;
}

export async function seedAssignments(
  prisma: PrismaClient,
  rng: Rng,
  missions: MissionsResult['missions'],
  consultants: Map<string, SeededConsultant>,
  staff: StaffMap,
): Promise<SeededAssignment[]> {
  const created: SeededAssignment[] = [];

  for (const [index, row] of STAFFING.entries()) {
    const mission = missions[row.mission - 1];
    const consultant = consultants.get(row.consultant);
    if (!mission || !consultant) {
      throw new Error(`Staffing row ${index + 1} references a missing mission/consultant`);
    }

    // An assignment never starts before the consultant was hired.
    const missionStart = days(mission.start);
    const startDate = missionStart < consultant.hireDate ? consultant.hireDate : missionStart;
    const endDate = mission.end === null ? null : days(mission.end);

    const assignmentId = sid(`assignment-${n2(index + 1)}`);
    await prisma.assignment.create({
      data: {
        id: assignmentId,
        missionId: mission.id,
        consultantId: consultant.id,
        roleOnMission: row.role,
        startDate,
        endDate,
        allocationPct: row.allocation,
        status: row.status,
        createdAt: days(mission.start - int(rng, 5, 25)),
      },
    });
    created.push({ id: assignmentId, missionId: mission.id, consultantId: consultant.id, role: row.role, status: row.status });
  }

  for (const [index, amendment] of AMENDMENTS.entries()) {
    const mission = missions[amendment.mission - 1];
    if (!mission) throw new Error(`Amendment ${index + 1} references a missing mission`);
    await prisma.missionAmendment.create({
      data: {
        id: sid(`mamend-${n2(index + 1)}`),
        missionId: mission.id,
        reason: amendment.reason,
        changes: amendment.changes,
        effectiveDate: days(amendment.effectiveDaysFromNow),
        createdById: staffOf(staff, amendment.author).id,
        createdAt: days(amendment.effectiveDaysFromNow - 7),
      },
    });
  }

  return created;
}
