/**
 * AI evaluations RBAC integration tests. Real Postgres via supertest.
 *   npx vitest run --config vitest.integration.config.ts test/ai-evaluations.integration.test.ts
 * Mocked: verifyToken (Bearer = role) and the anthropic lib (key ABSENT) so the
 * suite is deterministic and never performs a network call, even when the
 * developer's .env carries a real ANTHROPIC_API_KEY.
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

vi.mock('../src/lib/anthropic.js', () => ({
  AI_MODEL: 'claude-haiku-4-5',
  isAiConfigured: vi.fn(() => false),
  getAnthropicClient: vi.fn(() => {
    throw new Error('must not be called when unconfigured');
  }),
}));

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = buildApp();
const as = (t: string) => `Bearer ${t}`;

let applicationId = '';

async function resetDb(): Promise<void> {
  await prisma.aiEvaluation.deleteMany();
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

async function seed(): Promise<void> {
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
  const author = await prisma.user.findUniqueOrThrow({ where: { email: 'rh@internal.test' } });
  const post = await prisma.jobPost.create({
    data: {
      title: 'Dev Full-Stack',
      description: 'Build things',
      employmentType: 'CDI',
      publicToken: `tok-${Date.now()}`,
      authorId: author.id,
    },
  });
  const application = await prisma.application.create({
    data: {
      jobPostId: post.id,
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@test.fr',
      consentAcceptedAt: new Date(),
      jobTitleSnapshot: post.title,
      answers: [{ key: 'q1', label: 'Expérience ?', type: 'SHORT_TEXT', value: '5 ans' }],
    },
  });
  applicationId = application.id;
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
  await seed();
});

describe('GET /api/ai-evaluations/status — RBAC + availability flag', () => {
  it('RH/MANAGER/DIRECTION -> 200 { configured: false } (key absent)', async () => {
    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await request(app).get('/api/ai-evaluations/status').set('Authorization', as(role));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    }
  });

  it('CONSULTANT -> 403, unauthenticated -> 401', async () => {
    expect(
      (await request(app).get('/api/ai-evaluations/status').set('Authorization', as('CONSULTANT'))).status,
    ).toBe(403);
    expect((await request(app).get('/api/ai-evaluations/status')).status).toBe(401);
  });
});

describe('POST /api/job-posts/applications/:id/ai-evaluations — RBAC + degraded mode', () => {
  const trigger = (token?: string) => {
    const req = request(app).post(`/api/job-posts/applications/${applicationId}/ai-evaluations`);
    return token ? req.set('Authorization', as(token)) : req;
  };

  it('RH/DIRECTION pass RBAC and get a typed 503 AI_NOT_CONFIGURED (key absent)', async () => {
    for (const role of ['RH', 'DIRECTION']) {
      const res = await trigger(role);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    }
  });

  it('MANAGER -> 403, CONSULTANT -> 403, unauthenticated -> 401', async () => {
    expect((await trigger('MANAGER')).status).toBe(403);
    expect((await trigger('CONSULTANT')).status).toBe(403);
    expect((await trigger()).status).toBe(401);
  });
});

describe('GET /api/job-posts/applications/:id/ai-evaluations — RBAC + history', () => {
  const list = (token?: string) => {
    const req = request(app).get(`/api/job-posts/applications/${applicationId}/ai-evaluations`);
    return token ? req.set('Authorization', as(token)) : req;
  };

  it('RH/MANAGER/DIRECTION -> 200 with rows newest-first', async () => {
    const rh = await prisma.user.findUniqueOrThrow({ where: { email: 'rh@internal.test' } });
    for (const score of [40, 70]) {
      await prisma.aiEvaluation.create({
        data: {
          applicationId,
          score,
          verdict: 'GOOD_MATCH',
          strengths: ['x'],
          gaps: [],
          reasoning: 'r',
          model: 'claude-haiku-4-5',
          promptVersion: 'v1',
          createdById: rh.id,
          createdAt: new Date(Date.now() + score),
        },
      });
    }
    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await list(role);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].score).toBe(70);
      expect(res.body[0].createdBy).toMatchObject({ firstName: 'RH' });
    }
  });

  it('CONSULTANT -> 403, unauthenticated -> 401, unknown application -> 404', async () => {
    expect((await list('CONSULTANT')).status).toBe(403);
    expect((await list()).status).toBe(401);
    const res = await request(app)
      .get('/api/job-posts/applications/clzzzzzzzzzzzzzzzzzzzzzzz/ai-evaluations')
      .set('Authorization', as('RH'));
    expect(res.status).toBe(404);
  });

  it('existing application detail route still works through the new mount', async () => {
    const res = await request(app)
      .get(`/api/job-posts/applications/${applicationId}`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(applicationId);
  });
});
