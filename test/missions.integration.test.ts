/**
 * Missions integration tests — exercises the full middleware stack
 * (auth -> rbac -> validate -> controller -> service -> repository -> Postgres)
 * against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable. From `backend/`:
 *        docker compose up -d postgres
 *      and DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest `include`). Run it
 *      explicitly: npx vitest run test/missions.integration.test.ts
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
  // Order respects FK constraints.
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

/** Seed a Client + two Skills used across the mission tests. */
async function seedClientAndSkills() {
  const client = await prisma.client.create({
    data: { name: 'Acme Corp', industry: 'Tech' },
  });
  const skillA = await prisma.skill.create({ data: { name: 'TypeScript' } });
  const skillB = await prisma.skill.create({ data: { name: 'Postgres' } });
  return { client, skillA, skillB };
}

/** Seed a CONSULTANT User so its role gate can be exercised (403 expected). */
async function seedConsultant(token = 'CONSULTANT') {
  const upper = token.toUpperCase();
  await prisma.user.create({
    data: {
      keycloakId: `kc-${upper}`,
      email: `${upper.toLowerCase()}@internal.test`,
      firstName: upper,
      lastName: 'User',
      role: 'CONSULTANT',
    },
  });
}

function missionPayload(clientId: string, skillIds: string[] = []) {
  return {
    clientId,
    project: 'Apollo',
    role: 'Backend Engineer',
    startDate: new Date('2026-07-01').toISOString(),
    tjm: '500.00',
    requiredSkillIds: skillIds,
  };
}

async function createMissionAs(token: string, clientId: string, skillIds: string[] = []) {
  return request(app)
    .post('/api/missions')
    .set('Authorization', as(token))
    .send(missionPayload(clientId, skillIds));
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

describe('POST /api/missions (create)', () => {
  it('MANAGER -> 201', async () => {
    const { client, skillA } = await seedClientAndSkills();
    const res = await createMissionAs('MANAGER', client.id, [skillA.id]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ project: 'Apollo', status: 'DRAFT' });
    expect(res.body.requiredSkills).toHaveLength(1);
  });

  it('RH -> 403', async () => {
    const { client } = await seedClientAndSkills();
    const res = await createMissionAs('RH', client.id);
    expect(res.status).toBe(403);
  });

  it('CONSULTANT -> 403', async () => {
    const { client } = await seedClientAndSkills();
    await seedConsultant();
    const res = await createMissionAs('CONSULTANT', client.id);
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401', async () => {
    const { client } = await seedClientAndSkills();
    const res = await request(app).post('/api/missions').send(missionPayload(client.id));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// List — RBAC + archived filtering
// ---------------------------------------------------------------------------

describe('GET /api/missions (list)', () => {
  it('DIRECTION -> 200 with pagination envelope', async () => {
    const { client } = await seedClientAndSkills();
    await createMissionAs('MANAGER', client.id);
    const res = await request(app).get('/api/missions').set('Authorization', as('DIRECTION'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toHaveProperty('_assignmentCount', 0);
  });

  it('RH -> 200', async () => {
    await seedClientAndSkills();
    const res = await request(app).get('/api/missions').set('Authorization', as('RH'));
    expect(res.status).toBe(200);
  });

  it('CONSULTANT -> 403', async () => {
    await seedConsultant();
    const res = await request(app).get('/api/missions').set('Authorization', as('CONSULTANT'));
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401', async () => {
    const res = await request(app).get('/api/missions');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

describe('GET /api/missions/:id (detail)', () => {
  it('MANAGER -> 200 with client + counts', async () => {
    const { client, skillA } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id, [skillA.id]);
    const res = await request(app)
      .get(`/api/missions/${created.body.id}`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ id: client.id, name: 'Acme Corp' });
    expect(res.body).toHaveProperty('_activeAssignmentCount', 0);
    expect(res.body).toHaveProperty('_totalAssignmentCount', 0);
    expect(res.body).toHaveProperty('_amendmentCount', 0);
    expect(res.body.requiredSkills).toHaveLength(1);
  });

  it('RH -> 200', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .get(`/api/missions/${created.body.id}`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
  });

  it('non-existent id -> 404', async () => {
    const res = await request(app)
      .get('/api/missions/clzzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Update — RBAC
// ---------------------------------------------------------------------------

describe('PATCH /api/missions/:id (update)', () => {
  it('DIRECTION -> 200 applies update', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}`)
      .set('Authorization', as('DIRECTION'))
      .send({ project: 'Apollo II', tjm: '600.00' });
    expect(res.status).toBe(200);
    expect(res.body.project).toBe('Apollo II');
  });

  it('RH -> 403', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}`)
      .set('Authorization', as('RH'))
      .send({ project: 'Apollo II' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Status transition — RBAC + state machine
// ---------------------------------------------------------------------------

describe('PATCH /api/missions/:id/status', () => {
  it('MANAGER DRAFT -> STAFFED -> 200', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'STAFFED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('STAFFED');
  });

  it('invalid transition DRAFT -> IN_PROGRESS -> 400', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
  });

  it('ARCHIVED via /status -> 400 (schema rejects)', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'ARCHIVED' });
    expect(res.status).toBe(400);
  });

  it('RH -> 403', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'STAFFED' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Archive — excluded from default list, included with includeArchived
// ---------------------------------------------------------------------------

describe('PATCH /api/missions/:id/archive', () => {
  it('MANAGER archives -> 200; excluded from default list; included with ?includeArchived=true', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const id = created.body.id as string;

    const archiveRes = await request(app)
      .patch(`/api/missions/${id}/archive`)
      .set('Authorization', as('MANAGER'));
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.status).toBe('ARCHIVED');
    expect(archiveRes.body.archivedAt).not.toBeNull();

    const defaultList = await request(app)
      .get('/api/missions')
      .set('Authorization', as('MANAGER'));
    expect(defaultList.body.data.some((m: { id: string }) => m.id === id)).toBe(false);

    const withArchived = await request(app)
      .get('/api/missions?includeArchived=true')
      .set('Authorization', as('MANAGER'));
    expect(withArchived.body.data.some((m: { id: string }) => m.id === id)).toBe(true);
  });

  it('archive is idempotent (second call still 200)', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const id = created.body.id as string;
    await request(app).patch(`/api/missions/${id}/archive`).set('Authorization', as('MANAGER'));
    const second = await request(app)
      .patch(`/api/missions/${id}/archive`)
      .set('Authorization', as('MANAGER'));
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('ARCHIVED');
  });

  it('RH -> 403', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .patch(`/api/missions/${created.body.id}/archive`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Amendments — RBAC
// ---------------------------------------------------------------------------

describe('Mission amendments', () => {
  it('MANAGER creates amendment -> 201; DIRECTION lists -> 200', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const id = created.body.id as string;

    const createRes = await request(app)
      .post(`/api/missions/${id}/amendments`)
      .set('Authorization', as('MANAGER'))
      .send({
        reason: 'Scope change',
        changes: { tjm: { from: '500.00', to: '550.00' } },
        effectiveDate: new Date('2026-08-01').toISOString(),
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ reason: 'Scope change', missionId: id });

    const listRes = await request(app)
      .get(`/api/missions/${id}/amendments`)
      .set('Authorization', as('DIRECTION'));
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.data).toHaveLength(1);
  });

  it('RH creates amendment -> 403', async () => {
    const { client } = await seedClientAndSkills();
    const created = await createMissionAs('MANAGER', client.id);
    const res = await request(app)
      .post(`/api/missions/${created.body.id}/amendments`)
      .set('Authorization', as('RH'))
      .send({
        reason: 'x',
        changes: {},
        effectiveDate: new Date('2026-08-01').toISOString(),
      });
    expect(res.status).toBe(403);
  });
});
