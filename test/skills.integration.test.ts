/**
 * Skills referential integration tests — RBAC + CRUD + delete-in-use, across the
 * full middleware stack against a REAL Postgres. Run explicitly:
 *   npx vitest run --config vitest.integration.config.ts test/skills.integration.test.ts
 *
 * Mocked: `src/lib/keycloak.js#verifyToken` (Bearer token = role).
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
const as = (token: string) => `Bearer ${token}`;

async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
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
  for (const role of ['RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'] as const) {
    await prisma.user.create({
      data: {
        keycloakId: `kc-${role}`,
        email: `${role.toLowerCase()}@internal.test`,
        firstName: role,
        lastName: 'User',
        role,
      },
    });
  }
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
  await seedUsers();
});

describe('GET /api/skills (read — all authenticated roles)', () => {
  beforeEach(async () => {
    await prisma.skill.createMany({
      data: [
        { name: 'Go', category: 'Backend' },
        { name: 'React', category: 'Frontend' },
      ],
    });
  });

  it.each(['RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'])('%s -> 200', async (role) => {
    const res = await request(app).get('/api/skills').set('Authorization', as(role));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('unauthenticated -> 401', async () => {
    expect((await request(app).get('/api/skills')).status).toBe(401);
  });

  it('?search filters by name', async () => {
    const res = await request(app).get('/api/skills?search=rea').set('Authorization', as('RH'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('React');
  });
});

describe('POST /api/skills (manage — RH/DIRECTION)', () => {
  it('RH -> 201', async () => {
    const res = await request(app)
      .post('/api/skills')
      .set('Authorization', as('RH'))
      .send({ name: 'Rust', category: 'backend' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Rust', category: 'Backend' });
  });

  it('duplicate name -> 409 SKILL_ALREADY_EXISTS', async () => {
    await request(app).post('/api/skills').set('Authorization', as('RH')).send({ name: 'Rust' });
    const res = await request(app)
      .post('/api/skills')
      .set('Authorization', as('DIRECTION'))
      .send({ name: 'Rust' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('SKILL_ALREADY_EXISTS');
  });

  it('MANAGER -> 403, CONSULTANT -> 403', async () => {
    for (const role of ['MANAGER', 'CONSULTANT']) {
      const res = await request(app)
        .post('/api/skills')
        .set('Authorization', as(role))
        .send({ name: `X-${role}` });
      expect(res.status).toBe(403);
    }
  });

  it('rejects unknown fields (.strict)', async () => {
    const res = await request(app)
      .post('/api/skills')
      .set('Authorization', as('RH'))
      .send({ name: 'Y', hacker: true });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/skills/:id', () => {
  it('DIRECTION -> 200; MANAGER -> 403', async () => {
    const skill = await prisma.skill.create({ data: { name: 'Vue' } });
    const ok = await request(app)
      .patch(`/api/skills/${skill.id}`)
      .set('Authorization', as('DIRECTION'))
      .send({ category: 'frontend' });
    expect(ok.status).toBe(200);
    expect(ok.body.category).toBe('Frontend');

    const forbidden = await request(app)
      .patch(`/api/skills/${skill.id}`)
      .set('Authorization', as('MANAGER'))
      .send({ name: 'Vue3' });
    expect(forbidden.status).toBe(403);
  });
});

describe('DELETE /api/skills/:id', () => {
  it('unused skill -> 204', async () => {
    const skill = await prisma.skill.create({ data: { name: 'Temp' } });
    const res = await request(app).delete(`/api/skills/${skill.id}`).set('Authorization', as('RH'));
    expect(res.status).toBe(204);
    expect(await prisma.skill.findUnique({ where: { id: skill.id } })).toBeNull();
  });

  it('skill linked to a consultant -> 409 SKILL_IN_USE with breakdown', async () => {
    const skill = await prisma.skill.create({ data: { name: 'Linked' } });
    const user = await prisma.user.create({
      data: { keycloakId: 'kc-owner', email: 'owner@internal.test', firstName: 'O', lastName: 'W', role: 'CONSULTANT' },
    });
    await prisma.consultant.create({
      data: { userId: user.id, position: 'Eng', status: 'AVAILABLE', skills: { connect: { id: skill.id } } },
    });
    const res = await request(app).delete(`/api/skills/${skill.id}`).set('Authorization', as('RH'));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('SKILL_IN_USE');
    expect(res.body.error.details.breakdown.consultants).toBe(1);
    expect(await prisma.skill.findUnique({ where: { id: skill.id } })).not.toBeNull();
  });

  it('CONSULTANT -> 403', async () => {
    const skill = await prisma.skill.create({ data: { name: 'Z' } });
    expect(
      (await request(app).delete(`/api/skills/${skill.id}`).set('Authorization', as('CONSULTANT'))).status,
    ).toBe(403);
  });
});
