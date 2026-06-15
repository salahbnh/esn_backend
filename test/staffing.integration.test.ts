/**
 * Staffing integration tests — exercises the full middleware stack
 * (auth -> rbac -> ownership -> validate -> controller -> service ->
 * repository -> Postgres) against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable (docker compose up -d postgres) and
 *      DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest `include`). Run it
 *      explicitly: npx vitest run test/staffing.integration.test.ts
 *
 * What is mocked: `src/lib/keycloak.js#verifyToken`. The Bearer token string is
 * the application role; the DB is real and reset between tests.
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
  await prisma.missionAmendment.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.client.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.consultant.deleteMany();
  await prisma.user.deleteMany();
}

/** Seed a User of the given role; the keycloakId/email mirror the mock token. */
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

/** Seed a CONSULTANT user + profile; returns both. */
async function seedConsultant(token: string, status: 'AVAILABLE' | 'ON_MISSION' | 'INTERCONTRAT' = 'AVAILABLE') {
  const user = await seedUser(token, 'CONSULTANT');
  const consultant = await prisma.consultant.create({
    data: { userId: user.id, position: 'Engineer', status },
  });
  return { user, consultant };
}

async function seedClientAndMission(status: 'DRAFT' | 'STAFFED' = 'DRAFT') {
  const client = await prisma.client.create({ data: { name: 'Acme Corp' } });
  const mission = await prisma.mission.create({
    data: {
      clientId: client.id,
      project: 'Apollo',
      role: 'Backend Engineer',
      startDate: new Date('2026-07-01'),
      tjm: '500.00',
      status,
    },
  });
  return { client, mission };
}

function assignmentPayload(
  missionId: string,
  consultantId: string,
  allocationPct = 100,
) {
  return {
    missionId,
    consultantId,
    startDate: new Date('2026-07-01').toISOString(),
    allocationPct,
  };
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
// Create — RBAC
// ---------------------------------------------------------------------------

describe('POST /api/staffing/assignments', () => {
  it('MANAGER -> 201 PROPOSED', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission();
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const res = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, consultant.id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PROPOSED' });
    expect(res.body.consultant.user).toMatchObject({ firstName: 'CONSULTANT_A' });
    expect(res.body.consultant).not.toHaveProperty('keycloakId');
  });

  it('RH -> 403', async () => {
    await seedUser('RH', 'RH');
    const { mission } = await seedClientAndMission();
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const res = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('RH'))
      .send(assignmentPayload(mission.id, consultant.id));
    expect(res.status).toBe(403);
  });

  it('rejects assignment to a CLOSED mission -> 400', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const client = await prisma.client.create({ data: { name: 'Acme' } });
    const mission = await prisma.mission.create({
      data: {
        clientId: client.id,
        project: 'P',
        role: 'R',
        startDate: new Date('2026-07-01'),
        tjm: '500.00',
        status: 'CLOSED',
      },
    });
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const res = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, consultant.id));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// List — RBAC
// ---------------------------------------------------------------------------

describe('GET /api/staffing/assignments', () => {
  it('RH -> 200 with pagination envelope', async () => {
    await seedUser('RH', 'RH');
    const res = await request(app)
      .get('/api/staffing/assignments')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('CONSULTANT -> 403', async () => {
    await seedConsultant('CONSULTANT_A');
    const res = await request(app)
      .get('/api/staffing/assignments')
      .set('Authorization', as('CONSULTANT_A'));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// IDOR — consultant self-view + own-mission read
// ---------------------------------------------------------------------------

describe('IDOR — CONSULTANT cannot see other consultants', () => {
  it('A GET /api/consultants/me/assignments does not include B\'s assignment', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission();
    await seedConsultant('CONSULTANT_A');
    const { consultant: conB } = await seedConsultant('CONSULTANT_B');

    await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, conB.id));

    const mineA = await request(app)
      .get('/api/consultants/me/assignments')
      .set('Authorization', as('CONSULTANT_A'));
    expect(mineA.status).toBe(200);
    expect(mineA.body.total).toBe(0);

    const mineB = await request(app)
      .get('/api/consultants/me/assignments')
      .set('Authorization', as('CONSULTANT_B'));
    expect(mineB.body.total).toBe(1);
    expect(mineB.body.data[0].mission).toMatchObject({ project: 'Apollo' });
  });

  it('A cannot GET B\'s mission (403); B can read own (200)', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission();
    await seedConsultant('CONSULTANT_A');
    const { consultant: conB } = await seedConsultant('CONSULTANT_B');

    await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, conB.id));

    const aReads = await request(app)
      .get(`/api/missions/${mission.id}`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(aReads.status).toBe(403);

    const bReads = await request(app)
      .get(`/api/missions/${mission.id}`)
      .set('Authorization', as('CONSULTANT_B'));
    expect(bReads.status).toBe(200);
    expect(bReads.body).toMatchObject({ id: mission.id });
    // FIX 1: commercial fields are redacted for a CONSULTANT reader.
    expect(bReads.body.tjm).toBeUndefined();
    expect(bReads.body.client).not.toHaveProperty('contactName');
    expect(bReads.body.client).not.toHaveProperty('contactEmail');
  });

  it('a MANAGER reading the same mission still sees commercial fields', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const client = await prisma.client.create({
      data: { name: 'Globex', contactName: 'Jane Roe', contactEmail: 'jane@globex.test' },
    });
    const mission = await prisma.mission.create({
      data: {
        clientId: client.id,
        project: 'Zeus',
        role: 'Engineer',
        startDate: new Date('2026-07-01'),
        tjm: '650.00',
        status: 'DRAFT',
      },
    });
    const res = await request(app)
      .get(`/api/missions/${mission.id}`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
    // Prisma serializes Decimal without trailing zeros (string-decimal per api-design.md).
    expect(res.body.tjm).toBe('650');
    expect(res.body.client).toMatchObject({
      contactName: 'Jane Roe',
      contactEmail: 'jane@globex.test',
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end lifecycle: create -> CONFIRMED -> ACTIVE -> ENDED
// ---------------------------------------------------------------------------

describe('assignment lifecycle cascade', () => {
  async function advance(id: string, status: string, force = false) {
    return request(app)
      .patch(`/api/staffing/assignments/${id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status, ...(force ? { force: true } : {}) });
  }

  it('create -> CONFIRMED -> ACTIVE (mission STAFFED, consultant ON_MISSION) -> ENDED (INTERCONTRAT, mission stays STAFFED)', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission('DRAFT');
    const { consultant } = await seedConsultant('CONSULTANT_A', 'AVAILABLE');

    const created = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, consultant.id));
    const id = created.body.id as string;

    expect((await advance(id, 'CONFIRMED')).status).toBe(200);
    expect((await advance(id, 'ACTIVE')).body.status).toBe('ACTIVE');

    let m = await prisma.mission.findUnique({ where: { id: mission.id } });
    let c = await prisma.consultant.findUnique({ where: { id: consultant.id } });
    expect(m?.status).toBe('STAFFED');
    expect(c?.status).toBe('ON_MISSION');

    expect((await advance(id, 'ENDED')).body.status).toBe('ENDED');
    m = await prisma.mission.findUnique({ where: { id: mission.id } });
    c = await prisma.consultant.findUnique({ where: { id: consultant.id } });
    expect(c?.status).toBe('INTERCONTRAT');
    expect(m?.status).toBe('STAFFED'); // mission NOT changed on ENDED
  });

  it('over-allocation at activation: 80% active + 30% -> 400; +20% -> 200; force overrides', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission('DRAFT');
    const { mission: mission2 } = await seedClientAndMission('DRAFT');
    const { mission: mission3 } = await seedClientAndMission('DRAFT');
    const { consultant } = await seedConsultant('CONSULTANT_A', 'AVAILABLE');

    // First assignment ACTIVE at 80%.
    const a1 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, consultant.id, 80));
    await advance(a1.body.id, 'CONFIRMED');
    await advance(a1.body.id, 'ACTIVE');

    // Second assignment at 30% -> activation rejected (80 + 30 > 100).
    const a2 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission2.id, consultant.id, 30));
    await advance(a2.body.id, 'CONFIRMED');
    const over = await advance(a2.body.id, 'ACTIVE');
    expect(over.status).toBe(400);
    expect(over.body.error.details.code).toBe('OVER_ALLOCATED');

    // force overrides.
    const forced = await advance(a2.body.id, 'ACTIVE', true);
    expect(forced.status).toBe(200);

    // A fresh 20% assignment also fits within 100 when the consultant is at 80.
    const { consultant: con2 } = await seedConsultant('CONSULTANT_C', 'AVAILABLE');
    const b1 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, con2.id, 80));
    await advance(b1.body.id, 'CONFIRMED');
    await advance(b1.body.id, 'ACTIVE');
    const b2 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission3.id, con2.id, 20));
    await advance(b2.body.id, 'CONFIRMED');
    const ok = await advance(b2.body.id, 'ACTIVE');
    expect(ok.status).toBe(200);
  });

  it('PATCH allocationPct on an ACTIVE assignment: over-cap -> 400, force -> 200, within-cap (exclude-self) -> 200', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const { mission } = await seedClientAndMission('DRAFT');
    const { mission: mission2 } = await seedClientAndMission('DRAFT');
    const { consultant } = await seedConsultant('CONSULTANT_A', 'AVAILABLE');

    // First ACTIVE assignment at 80% (contributes to the consultant's active total).
    const a1 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission.id, consultant.id, 80));
    await advance(a1.body.id, 'CONFIRMED');
    await advance(a1.body.id, 'ACTIVE');

    // Second ACTIVE assignment at 20% (80 + 20 = 100 — fits).
    const a2 = await request(app)
      .post('/api/staffing/assignments')
      .set('Authorization', as('MANAGER'))
      .send(assignmentPayload(mission2.id, consultant.id, 20));
    await advance(a2.body.id, 'CONFIRMED');
    await advance(a2.body.id, 'ACTIVE');

    function patch(id: string, body: Record<string, unknown>) {
      return request(app)
        .patch(`/api/staffing/assignments/${id}`)
        .set('Authorization', as('MANAGER'))
        .send(body);
    }

    // Raise a2 to 30% -> consultant active total would be 80 + 30 = 110 -> 400.
    const over = await patch(a2.body.id, { allocationPct: 30 });
    expect(over.status).toBe(400);
    expect(over.body.error.details.code).toBe('OVER_ALLOCATED');

    // Same edit with force:true overrides -> 200.
    const forced = await patch(a2.body.id, { allocationPct: 30, force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.allocationPct).toBe(30);

    // Exclude-self: editing a1 (currently 80%) DOWN to 70% leaves others (a2=30)
    // + new (70) = 100 within cap -> 200 (a1's own 80 is not double-counted).
    const selfEdit = await patch(a1.body.id, { allocationPct: 70 });
    expect(selfEdit.status).toBe(200);
    expect(selfEdit.body.allocationPct).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Occupancy + suggestions RBAC
// ---------------------------------------------------------------------------

describe('occupancy + suggestions', () => {
  it('RH can read per-consultant occupancy (200) but not the global view (403)', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const scoped = await request(app)
      .get(`/api/staffing/occupancy/${consultant.id}`)
      .set('Authorization', as('RH'));
    expect(scoped.status).toBe(200);
    expect(scoped.body).toMatchObject({ consultantId: consultant.id, totalAllocationPct: 0 });

    // RH is excluded from the global cross-consultant view at the route.
    const global = await request(app)
      .get('/api/staffing/occupancy')
      .set('Authorization', as('RH'));
    expect(global.status).toBe(403);
  });

  it('suggestions returns AVAILABLE consultants with overlapping skills', async () => {
    await seedUser('MANAGER', 'MANAGER');
    const skill = await prisma.skill.create({ data: { name: 'TypeScript' } });
    const client = await prisma.client.create({ data: { name: 'Acme' } });
    const mission = await prisma.mission.create({
      data: {
        clientId: client.id,
        project: 'P',
        role: 'R',
        startDate: new Date('2026-07-01'),
        tjm: '500.00',
        requiredSkills: { connect: [{ id: skill.id }] },
      },
    });
    const { consultant } = await seedConsultant('CONSULTANT_A', 'AVAILABLE');
    await prisma.consultant.update({
      where: { id: consultant.id },
      data: { skills: { connect: [{ id: skill.id }] } },
    });

    const res = await request(app)
      .get(`/api/staffing/suggestions?missionId=${mission.id}`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ matchCount: 1 });

    // CONSULTANT cannot call suggestions.
    const forbidden = await request(app)
      .get(`/api/staffing/suggestions?missionId=${mission.id}`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(forbidden.status).toBe(403);
  });
});
