/**
 * Consultants integration tests — exercises the full middleware stack
 * (auth -> rbac/ownership -> validate -> controller -> service -> repository ->
 * Postgres) against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable. From `backend/`:
 *        docker compose up -d postgres
 *      and DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest `include`). Run it
 *      explicitly: npx vitest run test/consultants.integration.test.ts
 *
 * What is mocked: `src/lib/keycloak.js#verifyToken`. The Bearer token string is
 * BOTH the role and a discriminator so two distinct CONSULTANT identities can
 * coexist (e.g. `Bearer CONSULTANT_A` -> sub kc-CONSULTANT_A). The DB is real
 * and reset between tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The token string encodes "<ROLE>" or "<ROLE>_<SUFFIX>"; the leading segment up
// to the first underscore is the application role, the whole string identifies
// the Keycloak subject (so consultant A and B differ).
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

// The resend-invite endpoint delegates to Keycloak's execute-actions-email; mock
// the admin client so the test never touches a real identity provider.
vi.mock('../src/lib/keycloak-admin.js', () => ({
  provisionUser: vi.fn(async () => ({ id: 'kc-x' })),
  deleteUser: vi.fn(async () => undefined),
  activateUser: vi.fn(async () => undefined),
  checkKeycloakUsernameExists: vi.fn(async () => false),
  resendInvite: vi.fn(async () => undefined),
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
  await prisma.assignment.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.candidateEvaluation.deleteMany();
  await prisma.candidateInteraction.deleteMany();
  await prisma.consultant.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Seed a CONSULTANT User + linked Consultant for the given token identity. The
 * keycloakId must match the `sub` produced by the mocked verifyToken so that
 * `auth` resolves the SAME row (rather than JIT-provisioning a second one).
 */
async function seedConsultant(token: string, email: string) {
  const upper = token.toUpperCase();
  const user = await prisma.user.create({
    data: {
      keycloakId: `kc-${upper}`,
      email,
      firstName: upper,
      lastName: 'User',
      role: 'CONSULTANT',
    },
  });
  const consultant = await prisma.consultant.create({
    data: { userId: user.id, position: 'Engineer', status: 'AVAILABLE' },
  });
  return { user, consultant };
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
// RBAC matrix — list/detail
// ---------------------------------------------------------------------------

describe('RBAC — GET /api/consultants (list)', () => {
  it('RH -> 200', async () => {
    const res = await request(app).get('/api/consultants').set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('MANAGER -> 200 (read allowed)', async () => {
    const res = await request(app).get('/api/consultants').set('Authorization', as('MANAGER'));
    expect(res.status).toBe(200);
  });

  it('CONSULTANT -> 403', async () => {
    await seedConsultant('CONSULTANT', 'consultant@internal.test');
    const res = await request(app)
      .get('/api/consultants')
      .set('Authorization', as('CONSULTANT'));
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401', async () => {
    const res = await request(app).get('/api/consultants');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Self-service /me
// ---------------------------------------------------------------------------

describe('GET /api/consultants/me', () => {
  it('CONSULTANT -> 200 returns own profile only', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    await seedConsultant('CONSULTANT_B', 'b@internal.test');
    const res = await request(app)
      .get('/api/consultants/me')
      .set('Authorization', as('CONSULTANT_A'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.consultant.id);
    expect(res.body.user.email).toBe('a@internal.test');
  });

  it('RH -> 403 (must use /:id)', async () => {
    const res = await request(app)
      .get('/api/consultants/me')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(403);
  });

  it('CONSULTANT with no Consultant row -> 404', async () => {
    // No seed: auth JIT-provisions the User as CONSULTANT but no Consultant exists.
    const res = await request(app)
      .get('/api/consultants/me')
      .set('Authorization', as('CONSULTANT'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/consultants/me', () => {
  it('CONSULTANT (bio only) -> 200', async () => {
    await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch('/api/consultants/me')
      .set('Authorization', as('CONSULTANT_A'))
      .send({ bio: 'Updated bio' });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('Updated bio');
  });

  it('RH -> 403', async () => {
    const res = await request(app)
      .patch('/api/consultants/me')
      .set('Authorization', as('RH'))
      .send({ bio: 'x' });
    expect(res.status).toBe(403);
  });

  it('CONSULTANT sending `position` -> 400 (.strict rejects admin field)', async () => {
    await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch('/api/consultants/me')
      .set('Authorization', as('CONSULTANT_A'))
      .send({ position: 'Lead Engineer' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Admin update + status RBAC
// ---------------------------------------------------------------------------

describe('PATCH /api/consultants/:id', () => {
  it('RH -> 200 and applies update', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}`)
      .set('Authorization', as('RH'))
      .send({ position: 'Tech Lead', tjm: '650.00' });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe('Tech Lead');
  });

  it('MANAGER -> 403', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}`)
      .set('Authorization', as('MANAGER'))
      .send({ position: 'Tech Lead' });
    expect(res.status).toBe(403);
  });

  it('CONSULTANT -> 403 (role gate stops it before ownership)', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}`)
      .set('Authorization', as('CONSULTANT_A'))
      .send({ position: 'Tech Lead' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/consultants/:id/status', () => {
  it('MANAGER -> 200 (AVAILABLE -> ON_MISSION)', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'ON_MISSION' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ON_MISSION');
  });

  it('CONSULTANT -> 403', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}/status`)
      .set('Authorization', as('CONSULTANT_A'))
      .send({ status: 'ON_MISSION' });
    expect(res.status).toBe(403);
  });

  it('reversible flow AVAILABLE -> INTERCONTRAT -> ON_MISSION -> AVAILABLE', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const url = `/api/consultants/${a.consultant.id}/status`;
    for (const status of ['INTERCONTRAT', 'ON_MISSION', 'AVAILABLE'] as const) {
      const res = await request(app)
        .patch(url)
        .set('Authorization', as('RH'))
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('same-state transition AVAILABLE -> AVAILABLE -> 400', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .patch(`/api/consultants/${a.consultant.id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'AVAILABLE' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Onboarding — POST /:id/resend-invite (RH/DIRECTION only)
// ---------------------------------------------------------------------------

describe('POST /api/consultants/:id/resend-invite', () => {
  it('RH -> 204', async () => {
    const c = await seedConsultant('CONSULTANT_R', 'r@internal.test');
    const res = await request(app)
      .post(`/api/consultants/${c.consultant.id}/resend-invite`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(204);
  });

  it('DIRECTION -> 204', async () => {
    const c = await seedConsultant('CONSULTANT_D', 'd@internal.test');
    const res = await request(app)
      .post(`/api/consultants/${c.consultant.id}/resend-invite`)
      .set('Authorization', as('DIRECTION'));
    expect(res.status).toBe(204);
  });

  it('MANAGER -> 403', async () => {
    const c = await seedConsultant('CONSULTANT_M', 'm@internal.test');
    const res = await request(app)
      .post(`/api/consultants/${c.consultant.id}/resend-invite`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(403);
  });

  it('CONSULTANT -> 403', async () => {
    const c = await seedConsultant('CONSULTANT_S', 's@internal.test');
    const res = await request(app)
      .post(`/api/consultants/${c.consultant.id}/resend-invite`)
      .set('Authorization', as('CONSULTANT_S'));
    expect(res.status).toBe(403);
  });

  it('RH on unknown id -> 404', async () => {
    const res = await request(app)
      .post('/api/consultants/clnonexistentxxxxxxxxxxxxx/resend-invite')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// IDOR — GET /:id/documents
// ---------------------------------------------------------------------------

describe('GET /api/consultants/:id/documents (ownership)', () => {
  it('CONSULTANT A on own id -> 200', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .get(`/api/consultants/${a.consultant.id}/documents`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("CONSULTANT A on B's id -> 403 (IDOR blocked)", async () => {
    await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const b = await seedConsultant('CONSULTANT_B', 'b@internal.test');
    const res = await request(app)
      .get(`/api/consultants/${b.consultant.id}/documents`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(res.status).toBe(403);
  });

  it('RH -> 200 on any consultant', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .get(`/api/consultants/${a.consultant.id}/documents`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
  });

  it('MANAGER -> 403 (excluded)', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .get(`/api/consultants/${a.consultant.id}/documents`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(403);
  });

  it('document metadata never exposes storageKey', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    await prisma.document.create({
      data: {
        type: 'CV',
        entityType: 'CONSULTANT',
        entityId: a.consultant.id,
        filename: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        storageKey: 'secret-key-123',
        uploadedById: a.user.id,
      },
    });
    const res = await request(app)
      .get(`/api/consultants/${a.consultant.id}/documents`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty('storageKey');
    expect(res.body.data[0]).toMatchObject({ filename: 'cv.pdf', mimeType: 'application/pdf' });
  });
});

// ---------------------------------------------------------------------------
// Detail endpoint
// ---------------------------------------------------------------------------

describe('GET /api/consultants/:id (detail)', () => {
  it('RH -> 200 with _assignmentCount and documents (no storageKey)', async () => {
    const a = await seedConsultant('CONSULTANT_A', 'a@internal.test');
    const res = await request(app)
      .get(`/api/consultants/${a.consultant.id}`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('_assignmentCount', 0);
    expect(Array.isArray(res.body.documents)).toBe(true);
    expect(res.body.user.email).toBe('a@internal.test');
  });

  it('non-existent id -> 404', async () => {
    const res = await request(app)
      .get('/api/consultants/clzzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });
});
