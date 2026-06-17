/**
 * Reporting integration tests — exercises the full middleware stack
 * (auth -> rbac -> validate -> controller -> service -> repository -> Postgres)
 * against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable. From `backend/`:
 *        docker compose up -d postgres
 *      and DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest include). Run it
 *      explicitly: npx vitest run test/reporting.integration.test.ts
 *
 * What is mocked: `src/lib/keycloak.js#verifyToken`. The Bearer token's first
 * underscore-split segment is the application role; the DB is real and reset
 * between runs.
 *
 * Seeded dataset (deterministic):
 *   - C1: ON_MISSION, 1 ACTIVE assignment @100%
 *   - C2: INTERCONTRAT, no active assignment (0%)
 *   - C3: AVAILABLE, 1 ACTIVE assignment @50% (also the CONSULTANT caller for /me)
 *     => occupancy avg = (100 + 0 + 50) / 3 = 50; distribution full=1 partial=1 unassigned=1
 *   - 2 candidates: APPLIED, INTERVIEW (created now)
 *   - missions: M1 IN_PROGRESS (past start), M2 STAFFED (future start), M3 CLOSED (10-day duration)
 *   - 1 contract: SIGNED (archivedAt null)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/keycloak.js', () => ({
  verifyToken: vi.fn(async (token: string) => {
    const upper = token.toUpperCase();
    const role = upper.split('_')[0];
    return {
      sub: `kc-${upper}`,
      email: `${upper.toLowerCase()}@internal.test`,
      email_verified: true,
      given_name: role,
      family_name: 'User',
      realm_access: { roles: [role] },
    };
  }),
}));

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = buildApp();

function as(token: string) {
  return `Bearer ${token}`;
}

async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.contractValidation.deleteMany();
  await prisma.contractAmendment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.missionAmendment.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.client.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.consultant.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser(token: string, role: 'RH' | 'MANAGER' | 'DIRECTION' | 'CONSULTANT') {
  const upper = token.toUpperCase();
  return prisma.user.create({
    data: {
      keycloakId: `kc-${upper}`,
      email: `${upper.toLowerCase()}@internal.test`,
      firstName: upper,
      lastName: 'User',
      role,
    },
  });
}

async function seedConsultant(
  token: string,
  status: 'AVAILABLE' | 'ON_MISSION' | 'INTERCONTRAT',
) {
  const user = await seedUser(token, 'CONSULTANT');
  const consultant = await prisma.consultant.create({
    data: { userId: user.id, position: 'Engineer', status },
  });
  return { user, consultant };
}

/**
 * Seed the full deterministic dataset. Returns the C3 consultant (the /me caller)
 * and its token. C3's token is `CONSULTANT_C3` -> role CONSULTANT.
 */
async function seedDataset() {
  // Staff roles.
  await seedUser('RH', 'RH');
  await seedUser('MANAGER', 'MANAGER');
  await seedUser('DIRECTION', 'DIRECTION');

  // Consultants.
  const { consultant: c1 } = await seedConsultant('CONSULTANT_C1', 'ON_MISSION');
  await seedConsultant('CONSULTANT_C2', 'INTERCONTRAT');
  const { consultant: c3 } = await seedConsultant('CONSULTANT_C3', 'AVAILABLE');

  // Client + missions.
  const client = await prisma.client.create({ data: { name: 'Acme Corp' } });
  const m1 = await prisma.mission.create({
    data: {
      clientId: client.id,
      project: 'In Progress Project',
      role: 'Engineer',
      startDate: new Date('2026-01-01'),
      tjm: '500.00',
      status: 'IN_PROGRESS',
    },
  });
  await prisma.mission.create({
    data: {
      clientId: client.id,
      project: 'Forecast Project',
      role: 'Engineer',
      startDate: new Date('2099-01-01'),
      tjm: '500.00',
      status: 'STAFFED',
    },
  });
  await prisma.mission.create({
    data: {
      clientId: client.id,
      project: 'Closed Project',
      role: 'Engineer',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-02-11'), // 10-day duration
      tjm: '500.00',
      status: 'CLOSED',
    },
  });

  // Active assignments: C1 @100% on M1, C3 @50% on M1.
  await prisma.assignment.create({
    data: {
      missionId: m1.id,
      consultantId: c1.id,
      startDate: new Date('2026-01-01'),
      allocationPct: 100,
      status: 'ACTIVE',
    },
  });
  await prisma.assignment.create({
    data: {
      missionId: m1.id,
      consultantId: c3.id,
      startDate: new Date('2026-01-01'),
      allocationPct: 50,
      status: 'ACTIVE',
    },
  });

  // Candidates.
  await prisma.candidate.create({
    data: { firstName: 'Cand', lastName: 'A', email: 'ca@x.test', status: 'APPLIED' },
  });
  await prisma.candidate.create({
    data: { firstName: 'Cand', lastName: 'B', email: 'cb@x.test', status: 'INTERVIEW' },
  });

  // Contract (SIGNED, not archived).
  await prisma.contract.create({
    data: { consultantId: c1.id, type: 'CDI', status: 'SIGNED', prefilledData: {} },
  });

  return { c3 };
}

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

describe('GET /api/reports/occupancy', () => {
  it('RH -> 200 with company-wide avg incl. bench', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/occupancy')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.globalAvgAllocationPct).toBe(50);
    expect(res.body.totalConsultants).toBe(3);
    expect(res.body.consultantsByStatus).toEqual({
      ON_MISSION: 1,
      INTERCONTRAT: 1,
      AVAILABLE: 1,
    });
    expect(res.body.distribution).toEqual({ full: 1, partial: 1, unassigned: 1 });
  });

  it('MANAGER -> 200 (allowed)', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/occupancy')
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
  });

  it('CONSULTANT -> 403', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/occupancy')
      .set('Authorization', as('CONSULTANT_C3'));
    expect(res.status).toBe(403);
  });

  it('no token -> 401', async () => {
    const res = await request(app).get('/api/reports/occupancy');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe('GET /api/reports/pipeline', () => {
  it('RH -> 200 funnel with missing statuses filled', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/pipeline')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.funnel).toEqual({
      APPLIED: 1,
      INTERVIEW: 1,
      VALIDATED: 0,
      REJECTED: 0,
      HIRED: 0,
    });
    expect(res.body.total).toBe(2);
  });

  it('DIRECTION -> 200', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/pipeline')
      .set('Authorization', as('DIRECTION'));
    expect(res.status).toBe(200);
  });

  it('MANAGER -> 403 (excluded per D2)', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/pipeline')
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(403);
  });

  it('future window -> all counts 0', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/pipeline?from=2099-01-01T00:00:00.000Z')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.funnel).toEqual({
      APPLIED: 0,
      INTERVIEW: 0,
      VALIDATED: 0,
      REJECTED: 0,
      HIRED: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

describe('GET /api/reports/missions', () => {
  it('RH -> 200 with byStatus / activeCount / forecastCount / avgDuration', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/missions')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.byStatus.IN_PROGRESS).toBe(1);
    expect(res.body.byStatus.STAFFED).toBe(1);
    expect(res.body.byStatus.CLOSED).toBe(1);
    expect(res.body.activeCount).toBe(1);
    expect(res.body.forecastCount).toBe(1);
    expect(res.body.avgDurationDays).toBe(10);
    // 3 missions seeded (IN_PROGRESS, STAFFED, CLOSED); none archived.
    expect(res.body.totalMissions).toBe(3);
  });

  it('MANAGER -> 200 (allowed)', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/missions')
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
  });

  it('date window filters on startDate', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/missions?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    // The 2099 STAFFED mission falls outside the window.
    expect(res.body.byStatus.STAFFED).toBe(0);
    expect(res.body.byStatus.IN_PROGRESS).toBe(1);
    expect(res.body.byStatus.CLOSED).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

describe('GET /api/reports/hr', () => {
  it('RH -> 200 headcount + contracts', async () => {
    await seedDataset();
    const res = await request(app).get('/api/reports/hr').set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.headcount.total).toBe(3);
    expect(res.body.headcount.byStatus).toEqual({
      ON_MISSION: 1,
      INTERCONTRAT: 1,
      AVAILABLE: 1,
    });
    expect(res.body.intercontratCount).toBe(1);
    expect(res.body.contractsByStatus.SIGNED).toBe(1);
  });

  it('MANAGER -> 403 (excluded per D2)', async () => {
    await seedDataset();
    const res = await request(app).get('/api/reports/hr').set('Authorization', as('MANAGER'));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Summary — role filtering
// ---------------------------------------------------------------------------

describe('GET /api/reports/summary', () => {
  it('RH -> 200 with all four blocks', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('occupancy');
    expect(res.body).toHaveProperty('missions');
    expect(res.body).toHaveProperty('pipeline');
    expect(res.body).toHaveProperty('hr');
  });

  it('DIRECTION -> 200 with all four blocks', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', as('DIRECTION'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('occupancy');
    expect(res.body).toHaveProperty('pipeline');
    expect(res.body).toHaveProperty('missions');
    expect(res.body).toHaveProperty('hr');
  });

  it('MANAGER -> 200 with ONLY occupancy + missions', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('occupancy');
    expect(res.body).toHaveProperty('missions');
    expect(res.body).not.toHaveProperty('pipeline');
    expect(res.body).not.toHaveProperty('hr');
  });

  it('CONSULTANT -> 403', async () => {
    await seedDataset();
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', as('CONSULTANT_C3'));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// /me — CONSULTANT own dashboard
// ---------------------------------------------------------------------------

describe('GET /api/reports/me', () => {
  it('CONSULTANT (C3) -> 200 with own active assignment only', async () => {
    const { c3 } = await seedDataset();
    const res = await request(app)
      .get('/api/reports/me')
      .set('Authorization', as('CONSULTANT_C3'));
    expect(res.status).toBe(200);
    expect(res.body.consultantId).toBe(c3.id);
    expect(res.body.activeAllocationPct).toBe(50);
    expect(res.body.activeAssignmentsCount).toBe(1);
    expect(res.body.activeMissions).toHaveLength(1);
    expect(res.body.activeMissions[0]).toMatchObject({
      project: 'In Progress Project',
      clientName: 'Acme Corp',
      allocationPct: 50,
    });
    // Assignment startDate seeded as 2026-01-01; endDate null.
    expect(res.body.activeMissions[0].startDate).toBe('2026-01-01T00:00:00.000Z');
    expect(res.body.activeMissions[0].endDate).toBeNull();
  });

  it('RH -> 403 (only CONSULTANT allowed on /me)', async () => {
    await seedDataset();
    const res = await request(app).get('/api/reports/me').set('Authorization', as('RH'));
    expect(res.status).toBe(403);
  });

  it('CONSULTANT with no linked Consultant profile -> 404', async () => {
    await seedDataset();
    // A CONSULTANT-role user with NO consultant row. Token CONSULTANT_NOPROFILE
    // -> role CONSULTANT, sub kc-CONSULTANT_NOPROFILE (matches verifyToken mock).
    await seedUser('CONSULTANT_NOPROFILE', 'CONSULTANT');
    const res = await request(app)
      .get('/api/reports/me')
      .set('Authorization', as('CONSULTANT_NOPROFILE'));
    expect(res.status).toBe(404);
  });
});
