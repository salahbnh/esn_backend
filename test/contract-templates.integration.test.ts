/**
 * Contract-templates integration tests — exercises the full middleware stack
 * (auth -> rbac -> validate -> controller -> service -> repository -> Postgres)
 * against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable (docker compose up -d postgres) and
 *      DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest `include`). Run it
 *      explicitly: npx vitest run test/contract-templates.integration.test.ts
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
  await prisma.contractAmendment.deleteMany();
  await prisma.contractValidation.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.contractTemplate.deleteMany();
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

async function seedConsultant(token: string) {
  const user = await seedUser(token, 'CONSULTANT');
  await prisma.consultant.create({
    data: { userId: user.id, position: 'Engineer', tjm: '500.00', status: 'AVAILABLE' },
  });
}

/** Seeds RH/MANAGER/DIRECTION actors + a consultant. */
async function seedActors() {
  await seedUser('RH', 'RH');
  await seedUser('MANAGER', 'MANAGER');
  await seedUser('DIRECTION', 'DIRECTION');
  await seedConsultant('CONSULTANT_A');
}

function createPayload() {
  return { name: 'CDI standard', body: 'Contrat {{type}} pour {{firstName}} {{lastName}}.' };
}

function create(token: string) {
  return request(app)
    .post('/api/contract-templates')
    .set('Authorization', as(token))
    .send(createPayload());
}

async function seedTemplate() {
  const res = await create('RH');
  return res.body.id as string;
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
  await seedActors();
});

// ---------------------------------------------------------------------------
// Create — RBAC
// ---------------------------------------------------------------------------

describe('POST /api/contract-templates', () => {
  it('RH -> 201', async () => {
    const res = await create('RH');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'CDI standard', isActive: true });
  });

  it('DIRECTION -> 201', async () => {
    expect((await create('DIRECTION')).status).toBe(201);
  });

  it('MANAGER -> 403', async () => {
    expect((await create('MANAGER')).status).toBe(403);
  });

  it('CONSULTANT -> 403', async () => {
    expect((await create('CONSULTANT_A')).status).toBe(403);
  });

  it('writes a CONTRACT_TEMPLATE audit log', async () => {
    const id = await seedTemplate();
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'CONTRACT_TEMPLATE', entityId: id },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Update — RBAC
// ---------------------------------------------------------------------------

describe('PATCH /api/contract-templates/:id', () => {
  it('RH -> 200, DIRECTION -> 200, MANAGER -> 403, CONSULTANT -> 403', async () => {
    const id = await seedTemplate();

    const rh = await request(app)
      .patch(`/api/contract-templates/${id}`)
      .set('Authorization', as('RH'))
      .send({ name: 'Renamed' });
    expect(rh.status).toBe(200);
    expect(rh.body.name).toBe('Renamed');

    const dir = await request(app)
      .patch(`/api/contract-templates/${id}`)
      .set('Authorization', as('DIRECTION'))
      .send({ name: 'Renamed again' });
    expect(dir.status).toBe(200);

    const mgr = await request(app)
      .patch(`/api/contract-templates/${id}`)
      .set('Authorization', as('MANAGER'))
      .send({ name: 'x' });
    expect(mgr.status).toBe(403);

    const con = await request(app)
      .patch(`/api/contract-templates/${id}`)
      .set('Authorization', as('CONSULTANT_A'))
      .send({ name: 'x' });
    expect(con.status).toBe(403);
  });

  it('unknown id -> 404', async () => {
    const res = await request(app)
      .patch('/api/contract-templates/ckzzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Authorization', as('RH'))
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Deactivate — RBAC + effect
// ---------------------------------------------------------------------------

describe('PATCH /api/contract-templates/:id/deactivate', () => {
  it('RH -> 200 sets isActive=false; MANAGER -> 403; CONSULTANT -> 403', async () => {
    const id = await seedTemplate();

    const mgr = await request(app)
      .patch(`/api/contract-templates/${id}/deactivate`)
      .set('Authorization', as('MANAGER'));
    expect(mgr.status).toBe(403);

    const con = await request(app)
      .patch(`/api/contract-templates/${id}/deactivate`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(con.status).toBe(403);

    const rh = await request(app)
      .patch(`/api/contract-templates/${id}/deactivate`)
      .set('Authorization', as('RH'));
    expect(rh.status).toBe(200);
    expect(rh.body.isActive).toBe(false);

    const row = await prisma.contractTemplate.findUniqueOrThrow({ where: { id } });
    expect(row.isActive).toBe(false);
  });

  it('DIRECTION -> 200', async () => {
    const id = await seedTemplate();
    const res = await request(app)
      .patch(`/api/contract-templates/${id}/deactivate`)
      .set('Authorization', as('DIRECTION'));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Reads — RBAC
// ---------------------------------------------------------------------------

describe('GET /api/contract-templates', () => {
  it('RH/MANAGER/DIRECTION -> 200; CONSULTANT -> 403', async () => {
    await seedTemplate();
    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await request(app)
        .get('/api/contract-templates')
        .set('Authorization', as(role));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
      expect(res.body.total).toBe(1);
    }

    const con = await request(app)
      .get('/api/contract-templates')
      .set('Authorization', as('CONSULTANT_A'));
    expect(con.status).toBe(403);
  });
});

describe('GET /api/contract-templates/:id', () => {
  it('RH/MANAGER/DIRECTION -> 200; CONSULTANT -> 403', async () => {
    const id = await seedTemplate();
    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await request(app)
        .get(`/api/contract-templates/${id}`)
        .set('Authorization', as(role));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id });
    }

    const con = await request(app)
      .get(`/api/contract-templates/${id}`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(con.status).toBe(403);
  });

  it('unknown id -> 404', async () => {
    const res = await request(app)
      .get('/api/contract-templates/ckzzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });

  it('returns placeholders introspected from the body (auto vs manual)', async () => {
    const create = await request(app)
      .post('/api/contract-templates')
      .set('Authorization', as('RH'))
      .send({ name: 'With bonus', body: 'Hi {{firstName}}, bonus {{bonus}}' });
    const id = create.body.id as string;

    const res = await request(app)
      .get(`/api/contract-templates/${id}`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.placeholders).toEqual([
      { name: 'firstName', source: 'auto' },
      { name: 'bonus', source: 'manual' },
    ]);
  });
});
