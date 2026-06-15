/**
 * Recruitment (ATS) integration tests — exercises the full middleware stack
 * (auth -> rbac -> validate -> controller -> service -> repository -> Postgres)
 * against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable. From `backend/`:
 *        docker compose up -d postgres
 *      and DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set (a populated
 *      `.env` from `.env.example` is enough — Keycloak/S3 values may be dummy
 *      URLs since both Keycloak modules are mocked below).
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/`, which is OUTSIDE the default vitest `include`
 *      (`src/**\/*.test.ts`). Run it explicitly:
 *        npx vitest run test/recruitment.integration.test.ts
 *
 * What is mocked: `src/lib/keycloak.js#verifyToken` (the Bearer token string IS
 * the role, e.g. `Bearer RH`) and `src/lib/keycloak-admin.js` (provisionUser /
 * deleteUser) — no network to Keycloak. The DB is real and reset between tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The token string is the role name; verifyToken returns matching claims.
vi.mock('../src/lib/keycloak.js', () => ({
  verifyToken: vi.fn(async (token: string) => {
    const role = token.toUpperCase();
    return {
      sub: `kc-${role}`,
      email: `${role.toLowerCase()}@internal.test`,
      email_verified: true,
      given_name: role,
      family_name: 'User',
      realm_access: { roles: [role] },
    };
  }),
}));

vi.mock('../src/lib/keycloak-admin.js', () => ({
  provisionUser: vi.fn(async () => ({ id: `kc-provisioned-${Date.now()}` })),
  deleteUser: vi.fn(async () => undefined),
}));

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = buildApp();

function as(role: 'RH' | 'MANAGER' | 'DIRECTION' | 'CONSULTANT') {
  return `Bearer ${role}`;
}

async function resetDb(): Promise<void> {
  // Order respects FK constraints.
  await prisma.auditLog.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.candidateEvaluation.deleteMany();
  await prisma.candidateInteraction.deleteMany();
  await prisma.consultant.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.user.deleteMany();
}

async function createCandidateAs(role: 'RH' = 'RH', email = 'ada@example.com') {
  const res = await request(app)
    .post('/api/candidates')
    .set('Authorization', as(role))
    .send({ firstName: 'Ada', lastName: 'Lovelace', email });
  return res;
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
// RBAC matrix
// ---------------------------------------------------------------------------

describe('RBAC — POST /api/candidates', () => {
  it('RH -> 201', async () => {
    const res = await createCandidateAs('RH');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'ada@example.com', status: 'APPLIED' });
  });

  it('MANAGER -> 403', async () => {
    const res = await request(app)
      .post('/api/candidates')
      .set('Authorization', as('MANAGER'))
      .send({ firstName: 'A', lastName: 'B', email: 'b@example.com' });
    expect(res.status).toBe(403);
  });

  it('CONSULTANT -> 403', async () => {
    const res = await request(app)
      .post('/api/candidates')
      .set('Authorization', as('CONSULTANT'))
      .send({ firstName: 'A', lastName: 'B', email: 'c@example.com' });
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401', async () => {
    const res = await request(app)
      .post('/api/candidates')
      .send({ firstName: 'A', lastName: 'B', email: 'd@example.com' });
    expect(res.status).toBe(401);
  });
});

describe('RBAC — GET /api/candidates (read)', () => {
  it('MANAGER -> 200 (read allowed)', async () => {
    await createCandidateAs('RH');
    const res = await request(app).get('/api/candidates').set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('CONSULTANT -> 403', async () => {
    const res = await request(app).get('/api/candidates').set('Authorization', as('CONSULTANT'));
    expect(res.status).toBe(403);
  });
});

describe('RBAC — mutations forbidden to MANAGER', () => {
  it('PATCH /:id/status as MANAGER -> 403', async () => {
    const created = await createCandidateAs('RH');
    const res = await request(app)
      .patch(`/api/candidates/${created.body.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'INTERVIEW' });
    expect(res.status).toBe(403);
  });

  it('POST /:id/convert as MANAGER -> 403', async () => {
    const created = await createCandidateAs('RH');
    const res = await request(app)
      .post(`/api/candidates/${created.body.id}/convert`)
      .set('Authorization', as('MANAGER'))
      .send({ position: 'Engineer' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('rejects unknown fields on create (400)', async () => {
    const res = await request(app)
      .post('/api/candidates')
      .set('Authorization', as('RH'))
      .send({ firstName: 'A', lastName: 'B', email: 'e@example.com', hacker: true });
    expect(res.status).toBe(400);
  });

  it('duplicate email on create -> 409', async () => {
    await createCandidateAs('RH', 'dup@example.com');
    const res = await createCandidateAs('RH', 'dup@example.com');
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: create -> INTERVIEW -> VALIDATED -> convert
// ---------------------------------------------------------------------------

describe('full pipeline create -> convert', () => {
  it('walks the happy path and produces a HIRED candidate + Consultant', async () => {
    const created = await createCandidateAs('RH', 'pipeline@example.com');
    expect(created.status).toBe(201);
    const id = created.body.id;

    const toInterview = await request(app)
      .patch(`/api/candidates/${id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'INTERVIEW' });
    expect(toInterview.status).toBe(200);
    expect(toInterview.body.status).toBe('INTERVIEW');

    const toValidated = await request(app)
      .patch(`/api/candidates/${id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'VALIDATED' });
    expect(toValidated.status).toBe(200);
    expect(toValidated.body.status).toBe('VALIDATED');

    const convert = await request(app)
      .post(`/api/candidates/${id}/convert`)
      .set('Authorization', as('DIRECTION'))
      .send({ position: 'Backend Engineer', tjm: '500.00' });
    expect(convert.status).toBe(201);
    expect(convert.body.candidate.status).toBe('HIRED');
    expect(convert.body.consultant).toMatchObject({ position: 'Backend Engineer', status: 'AVAILABLE' });

    // The new consultant's User row exists in the DB.
    const consultant = await prisma.consultant.findUnique({
      where: { id: convert.body.consultant.id },
      include: { user: true },
    });
    expect(consultant?.user.email).toBe('pipeline@example.com');
    expect(consultant?.candidateId).toBe(id);
  });

  it('rejects an invalid transition (APPLIED -> VALIDATED) with 400', async () => {
    const created = await createCandidateAs('RH', 'invalid@example.com');
    const res = await request(app)
      .patch(`/api/candidates/${created.body.id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'VALIDATED' });
    expect(res.status).toBe(400);
  });

  it('rejects transition of a HIRED candidate (400)', async () => {
    const created = await createCandidateAs('RH', 'hired@example.com');
    const id = created.body.id;
    await request(app).patch(`/api/candidates/${id}/status`).set('Authorization', as('RH')).send({ status: 'INTERVIEW' });
    await request(app).patch(`/api/candidates/${id}/status`).set('Authorization', as('RH')).send({ status: 'VALIDATED' });
    await request(app).post(`/api/candidates/${id}/convert`).set('Authorization', as('RH')).send({ position: 'Eng' });

    const res = await request(app)
      .patch(`/api/candidates/${id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'REJECTED' });
    expect(res.status).toBe(400);
  });

  it('convert on a non-VALIDATED candidate -> 400', async () => {
    const created = await createCandidateAs('RH', 'notready@example.com');
    const res = await request(app)
      .post(`/api/candidates/${created.body.id}/convert`)
      .set('Authorization', as('RH'))
      .send({ position: 'Eng' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Sub-resources
// ---------------------------------------------------------------------------

describe('sub-resources', () => {
  it('interaction on a non-existent candidate -> 404', async () => {
    const res = await request(app)
      .post('/api/candidates/clzzzzzzzzzzzzzzzzzzzzzzzz/interactions')
      .set('Authorization', as('RH'))
      .send({ type: 'CALL', occurredAt: new Date().toISOString(), summary: 'hi' });
    expect(res.status).toBe(404);
  });

  it('MANAGER can add an interaction (201) and authorId is the caller', async () => {
    const created = await createCandidateAs('RH');
    const res = await request(app)
      .post(`/api/candidates/${created.body.id}/interactions`)
      .set('Authorization', as('MANAGER'))
      .send({ type: 'NOTE', occurredAt: new Date().toISOString(), summary: 'screened' });
    expect(res.status).toBe(201);
    const manager = await prisma.user.findUnique({ where: { keycloakId: 'kc-MANAGER' } });
    expect(res.body.authorId).toBe(manager?.id);
  });

  it('proposals are not status-gated (DRAFT created on an APPLIED candidate)', async () => {
    const created = await createCandidateAs('RH');
    const res = await request(app)
      .post(`/api/candidates/${created.body.id}/proposals`)
      .set('Authorization', as('RH'))
      .send({ content: { salary: '60000', startDate: '2026-09-01' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', documentId: null });
  });

  it('GET proposals as DIRECTION -> 200, as MANAGER -> 403', async () => {
    const created = await createCandidateAs('RH');
    const ok = await request(app)
      .get(`/api/candidates/${created.body.id}/proposals`)
      .set('Authorization', as('DIRECTION'));
    expect(ok.status).toBe(200);

    const forbidden = await request(app)
      .get(`/api/candidates/${created.body.id}/proposals`)
      .set('Authorization', as('MANAGER'));
    expect(forbidden.status).toBe(403);
  });
});
