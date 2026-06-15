/**
 * Clients integration tests — exercises the full middleware stack
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
 *      explicitly: npx vitest run test/clients.integration.test.ts
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

function clientPayload(overrides: Record<string, unknown> = {}) {
  return { name: 'Acme Corp', industry: 'Tech', ...overrides };
}

async function createClientAs(token: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/clients')
    .set('Authorization', as(token))
    .send(clientPayload(overrides));
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

describe('POST /api/clients (create)', () => {
  it('MANAGER -> 201', async () => {
    const res = await createClientAs('MANAGER');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Acme Corp', industry: 'Tech' });
  });

  it('RH -> 201', async () => {
    const res = await createClientAs('RH');
    expect(res.status).toBe(201);
  });

  it('CONSULTANT -> 403', async () => {
    await seedConsultant();
    const res = await createClientAs('CONSULTANT');
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401', async () => {
    const res = await request(app).post('/api/clients').send(clientPayload());
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('GET /api/clients (list)', () => {
  it('RH -> 200 with pagination envelope', async () => {
    await createClientAs('MANAGER');
    const res = await request(app).get('/api/clients').set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it('CONSULTANT -> 403', async () => {
    await seedConsultant();
    const res = await request(app).get('/api/clients').set('Authorization', as('CONSULTANT'));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Detail — _missionCount
// ---------------------------------------------------------------------------

describe('GET /api/clients/:id (detail)', () => {
  it('returns the client with _missionCount', async () => {
    const created = await createClientAs('MANAGER');
    const res = await request(app)
      .get(`/api/clients/${created.body.id}`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, name: 'Acme Corp' });
    expect(res.body).toHaveProperty('_missionCount', 0);
  });

  it('non-existent id -> 404', async () => {
    const res = await request(app)
      .get('/api/clients/clzzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Update — RBAC
// ---------------------------------------------------------------------------

describe('PATCH /api/clients/:id (update)', () => {
  it('MANAGER -> 200 applies update', async () => {
    const created = await createClientAs('MANAGER');
    const res = await request(app)
      .patch(`/api/clients/${created.body.id}`)
      .set('Authorization', as('MANAGER'))
      .send({ name: 'Acme II' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme II');
  });

  it('CONSULTANT -> 403', async () => {
    const created = await createClientAs('MANAGER');
    await seedConsultant();
    const res = await request(app)
      .patch(`/api/clients/${created.body.id}`)
      .set('Authorization', as('CONSULTANT'))
      .send({ name: 'Acme II' });
    expect(res.status).toBe(403);
  });
});
