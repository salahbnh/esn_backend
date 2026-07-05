/**
 * Users admin integration tests — DIRECTION-only staff-account management.
 * Keycloak admin client is mocked (no real IdP); Postgres is real.
 *   npx vitest run --config vitest.integration.config.ts test/users.integration.test.ts
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

vi.mock('../src/lib/keycloak-admin.js', () => ({
  provisionUser: vi.fn(async () => ({ id: `kc-new-${Math.floor(Math.random() * 1e9)}` })),
  deleteUser: vi.fn(async () => undefined),
  activateUser: vi.fn(async () => undefined),
  setUserEnabled: vi.fn(async () => undefined),
  checkKeycloakUsernameExists: vi.fn(async () => false),
  resendInvite: vi.fn(async () => undefined),
}));

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { setUserEnabled } from '../src/lib/keycloak-admin.js';

const app = buildApp();
const as = (t: string) => `Bearer ${t}`;

async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.jobQuestion.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.contractAmendment.deleteMany();
  await prisma.contractValidation.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.contractTemplate.deleteMany();
  await prisma.missionAmendment.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.client.deleteMany();
  await prisma.consultant.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.candidateEvaluation.deleteMany();
  await prisma.candidateInteraction.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUsers() {
  const rows: Record<string, string> = {};
  for (const role of ['RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'] as const) {
    const u = await prisma.user.create({
      data: {
        keycloakId: `kc-${role}`,
        email: `${role.toLowerCase()}@internal.test`,
        firstName: role,
        lastName: 'User',
        role,
      },
    });
    rows[role] = u.id;
  }
  return rows;
}

let ids: Record<string, string>;

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  ids = await seedUsers();
});

describe('GET /api/users', () => {
  it('RH/MANAGER/DIRECTION -> 200; CONSULTANT -> 403', async () => {
    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await request(app).get('/api/users').set('Authorization', as(role));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(res.body.data[0]).not.toHaveProperty('keycloakId');
    }
    expect((await request(app).get('/api/users').set('Authorization', as('CONSULTANT'))).status).toBe(403);
  });

  it('?role=MANAGER filters (feeds the contract manager picker)', async () => {
    const res = await request(app).get('/api/users?role=MANAGER').set('Authorization', as('RH'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].role).toBe('MANAGER');
  });
});

describe('POST /api/users (create staff)', () => {
  it('DIRECTION -> 201 with a generated @esn.local email + audit', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', as('DIRECTION'))
      .send({ firstName: 'Nadia', lastName: 'Berrada', role: 'MANAGER' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('nadia.berrada@esn.local');
    expect(res.body.role).toBe('MANAGER');
    expect(res.body).not.toHaveProperty('keycloakId');

    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'USER', action: 'CREATE' } });
    expect(audit).not.toBeNull();
  });

  it('suffixes the email on collision', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', as('DIRECTION'))
      .send({ firstName: 'Nadia', lastName: 'Berrada', role: 'RH' });
    const second = await request(app)
      .post('/api/users')
      .set('Authorization', as('DIRECTION'))
      .send({ firstName: 'Nadia', lastName: 'Berrada', role: 'MANAGER' });
    expect(second.status).toBe(201);
    expect(second.body.email).toBe('nadia.berrada2@esn.local');
  });

  it('RH -> 403, MANAGER -> 403; CONSULTANT role not creatable -> 400', async () => {
    for (const role of ['RH', 'MANAGER']) {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', as(role))
        .send({ firstName: 'X', lastName: 'Y', role: 'RH' });
      expect(res.status).toBe(403);
    }
    const bad = await request(app)
      .post('/api/users')
      .set('Authorization', as('DIRECTION'))
      .send({ firstName: 'X', lastName: 'Y', role: 'CONSULTANT' });
    expect(bad.status).toBe(400);
  });
});

describe('PATCH /api/users/:id/status', () => {
  it('DIRECTION deactivates a manager -> Keycloak disabled + isActive false', async () => {
    const res = await request(app)
      .patch(`/api/users/${ids.MANAGER}/status`)
      .set('Authorization', as('DIRECTION'))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(vi.mocked(setUserEnabled)).toHaveBeenCalledWith('kc-MANAGER', false);
  });

  it('cannot deactivate yourself -> 409', async () => {
    const res = await request(app)
      .patch(`/api/users/${ids.DIRECTION}/status`)
      .set('Authorization', as('DIRECTION'))
      .send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('RH -> 403', async () => {
    const res = await request(app)
      .patch(`/api/users/${ids.MANAGER}/status`)
      .set('Authorization', as('RH'))
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/resend-invite', () => {
  it('DIRECTION -> 204; RH -> 403', async () => {
    expect(
      (await request(app).post(`/api/users/${ids.RH}/resend-invite`).set('Authorization', as('DIRECTION'))).status,
    ).toBe(204);
    expect(
      (await request(app).post(`/api/users/${ids.RH}/resend-invite`).set('Authorization', as('RH'))).status,
    ).toBe(403);
  });
});
