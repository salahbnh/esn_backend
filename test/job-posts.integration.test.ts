/**
 * Job Posts admin module integration tests — RBAC + lifecycle + question builder
 * + application triage + the RH link-into-ATS action. Real Postgres via supertest.
 *   npx vitest run --config vitest.integration.config.ts test/job-posts.integration.test.ts
 * Mocked: verifyToken (Bearer = role).
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
  for (const role of ['RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'] as const) {
    await prisma.user.create({
      data: { keycloakId: `kc-${role}`, email: `${role.toLowerCase()}@internal.test`, firstName: role, lastName: 'User', role },
    });
  }
}

const createPost = (token: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/job-posts')
    .set('Authorization', as(token))
    .send({ title: 'Dev Full-Stack', description: 'Build things', employmentType: 'CDI', ...extra });

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

describe('POST /api/job-posts (create) — RBAC', () => {
  it('RH -> 201 DRAFT with a public token', async () => {
    const res = await createPost('RH');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', title: 'Dev Full-Stack' });
    expect(typeof res.body.publicToken).toBe('string');
    expect(res.body.publicToken.length).toBeGreaterThan(10);
  });

  it('MANAGER -> 403, CONSULTANT -> 403', async () => {
    expect((await createPost('MANAGER')).status).toBe(403);
    expect((await createPost('CONSULTANT')).status).toBe(403);
  });

  it('rejects unknown fields (.strict)', async () => {
    const res = await createPost('RH', { hacker: true });
    expect(res.status).toBe(400);
  });
});

describe('lifecycle', () => {
  it('DRAFT -> publish rotates token -> close', async () => {
    const created = await createPost('RH');
    const id = created.body.id;
    const token1 = created.body.publicToken;

    const published = await request(app).post(`/api/job-posts/${id}/publish`).set('Authorization', as('RH'));
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publicToken).not.toBe(token1); // rotated

    const closed = await request(app).post(`/api/job-posts/${id}/close`).set('Authorization', as('DIRECTION'));
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('PATCH a PUBLISHED post -> 409 JOB_POST_NOT_DRAFT', async () => {
    const created = await createPost('RH');
    const id = created.body.id;
    await request(app).post(`/api/job-posts/${id}/publish`).set('Authorization', as('RH'));
    const res = await request(app)
      .patch(`/api/job-posts/${id}`)
      .set('Authorization', as('RH'))
      .send({ title: 'Changed' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('JOB_POST_NOT_DRAFT');
  });
});

describe('questions', () => {
  it('add / reorder / archive; choice type requires options', async () => {
    const id = (await createPost('RH')).body.id;

    const q1 = await request(app)
      .post(`/api/job-posts/${id}/questions`)
      .set('Authorization', as('RH'))
      .send({ key: 'years', label: 'Years of experience', type: 'NUMBER', required: true });
    expect(q1.status).toBe(201);

    // Choice type without options -> 400
    const bad = await request(app)
      .post(`/api/job-posts/${id}/questions`)
      .set('Authorization', as('RH'))
      .send({ key: 'lang', label: 'Language', type: 'SINGLE_CHOICE' });
    expect(bad.status).toBe(400);

    const q2 = await request(app)
      .post(`/api/job-posts/${id}/questions`)
      .set('Authorization', as('RH'))
      .send({ key: 'lang', label: 'Language', type: 'SINGLE_CHOICE', options: ['FR', 'EN'] });
    expect(q2.status).toBe(201);

    const reorder = await request(app)
      .post(`/api/job-posts/${id}/questions/reorder`)
      .set('Authorization', as('RH'))
      .send({ orderedIds: [q2.body.id, q1.body.id] });
    expect(reorder.status).toBe(204);

    const del = await request(app)
      .delete(`/api/job-posts/${id}/questions/${q1.body.id}`)
      .set('Authorization', as('RH'));
    expect(del.status).toBe(204);

    const list = await request(app).get(`/api/job-posts/${id}/questions`).set('Authorization', as('MANAGER'));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1); // q1 archived
    expect(list.body[0].key).toBe('lang');
  });

  it('MANAGER cannot add a question -> 403', async () => {
    const id = (await createPost('RH')).body.id;
    const res = await request(app)
      .post(`/api/job-posts/${id}/questions`)
      .set('Authorization', as('MANAGER'))
      .send({ key: 'x', label: 'X', type: 'SHORT_TEXT' });
    expect(res.status).toBe(403);
  });
});

// Seed an Application directly (public apply lands in Phase C).
async function seedApplication(jobPostId: string, email: string, skills: string[] = []) {
  return prisma.application.create({
    data: {
      jobPostId,
      firstName: 'Jane',
      lastName: 'Doe',
      email,
      consentAcceptedAt: new Date(),
      jobTitleSnapshot: 'Dev Full-Stack',
      answers: [{ key: 'years', label: 'Years', type: 'NUMBER', value: 5 }],
      declaredSkills: skills.map((name) => ({ name })),
      status: 'SUBMITTED',
    },
  });
}

describe('applications triage + link', () => {
  it('list + get + patch status (RH/MGR read; RH writes)', async () => {
    const id = (await createPost('RH')).body.id;
    const appRow = await seedApplication(id, 'jane@ext.test');

    const list = await request(app).get(`/api/job-posts/${id}/applications`).set('Authorization', as('MANAGER'));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const detail = await request(app).get(`/api/job-posts/applications/${appRow.id}`).set('Authorization', as('RH'));
    expect(detail.status).toBe(200);
    expect(detail.body.email).toBe('jane@ext.test');

    const patch = await request(app)
      .patch(`/api/job-posts/applications/${appRow.id}/status`)
      .set('Authorization', as('RH'))
      .send({ status: 'UNDER_REVIEW' });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe('UNDER_REVIEW');

    // MANAGER cannot patch status
    const forbidden = await request(app)
      .patch(`/api/job-posts/applications/${appRow.id}/status`)
      .set('Authorization', as('MANAGER'))
      .send({ status: 'SPAM' });
    expect(forbidden.status).toBe(403);
  });

  it('link creates a Candidate (APPLIED) with declared skills, sets LINKED', async () => {
    await prisma.skill.create({ data: { name: 'React' } });
    const id = (await createPost('RH')).body.id;
    const appRow = await seedApplication(id, 'newapplicant@ext.test', ['React']);

    const res = await request(app)
      .post(`/api/job-posts/applications/${appRow.id}/link`)
      .set('Authorization', as('RH'))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LINKED');
    expect(res.body.candidateId).toBeTruthy();

    const cand = await prisma.candidate.findUniqueOrThrow({
      where: { email: 'newapplicant@ext.test' },
      include: { skills: true },
    });
    expect(cand.status).toBe('APPLIED');
    expect(cand.source).toBe('PORTAL');
    expect(cand.skills.map((s) => s.name)).toContain('React');
  });

  it('re-linking an already-linked application -> 409 ALREADY_LINKED', async () => {
    const id = (await createPost('RH')).body.id;
    const appRow = await seedApplication(id, 'twice@ext.test');
    await request(app)
      .post(`/api/job-posts/applications/${appRow.id}/link`)
      .set('Authorization', as('RH'))
      .send({});
    const second = await request(app)
      .post(`/api/job-posts/applications/${appRow.id}/link`)
      .set('Authorization', as('RH'))
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe('ALREADY_LINKED');
  });

  it('link surfaces 409 CANDIDATE_IS_CONSULTANT when email is an internal user', async () => {
    const id = (await createPost('RH')).body.id;
    const appRow = await seedApplication(id, 'rh@internal.test'); // matches a seeded User
    const res = await request(app)
      .post(`/api/job-posts/applications/${appRow.id}/link`)
      .set('Authorization', as('RH'))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('CANDIDATE_IS_CONSULTANT');
  });

  it('link is RH-only (DIRECTION -> 403)', async () => {
    const id = (await createPost('RH')).body.id;
    const appRow = await seedApplication(id, 'x@ext.test');
    const res = await request(app)
      .post(`/api/job-posts/applications/${appRow.id}/link`)
      .set('Authorization', as('DIRECTION'))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('archive guard', () => {
  it('cannot hard-delete a post with applications -> 409', async () => {
    const id = (await createPost('RH')).body.id;
    await seedApplication(id, 'a@ext.test');
    const res = await request(app).delete(`/api/job-posts/${id}`).set('Authorization', as('RH'));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('JOB_POST_HAS_APPLICATIONS');
  });

  it('archives a post with no applications -> 204', async () => {
    const id = (await createPost('RH')).body.id;
    const res = await request(app).delete(`/api/job-posts/${id}`).set('Authorization', as('RH'));
    expect(res.status).toBe(204);
  });
});
