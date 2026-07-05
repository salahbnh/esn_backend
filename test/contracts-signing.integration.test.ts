/**
 * Contract two-party signing integration tests — the consultant-sign / reject /
 * countersign transitions + GET /mine, across the full middleware stack against a
 * REAL Postgres (+ real MinIO for the generated/stamped PDFs). Run explicitly:
 *   npx vitest run --config vitest.integration.config.ts test/contracts-signing.integration.test.ts
 *
 * Mocked: `src/lib/keycloak.js#verifyToken` (Bearer token = role; suffix after `_`
 * distinguishes subjects, e.g. CONSULTANT_A vs CONSULTANT_B).
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
  const consultant = await prisma.consultant.create({
    data: { userId: user.id, position: 'Engineer', tjm: '500.00', status: 'AVAILABLE' },
  });
  return { user, consultant };
}

let seededManagerId = '';

async function seedContext() {
  await seedUser('RH', 'RH');
  const mgr = await seedUser('MANAGER', 'MANAGER');
  seededManagerId = mgr.id;
  await seedUser('DIRECTION', 'DIRECTION');
  const { consultant: a } = await seedConsultant('CONSULTANT_A');
  const { consultant: b } = await seedConsultant('CONSULTANT_B');
  const template = await prisma.contractTemplate.create({
    data: {
      name: 'CDI standard',
      body: 'Contrat {{type}} pour {{firstName}} {{lastName}} ({{position}}) — TJM {{tjm}}.',
      isActive: true,
    },
  });
  return { consultantA: a.id, consultantB: b.id, templateId: template.id };
}

const createContract = (consultantId: string, templateId: string) =>
  request(app)
    .post('/api/contracts')
    .set('Authorization', as('RH'))
    .send({ consultantId, templateId, managerId: seededManagerId, type: 'CDI', startDate: new Date('2026-07-01').toISOString() });
const submit = (id: string) => request(app).patch(`/api/contracts/${id}/submit`).set('Authorization', as('RH'));
const validate = (token: string, id: string) =>
  request(app).patch(`/api/contracts/${id}/validate`).set('Authorization', as(token)).send({ decision: 'APPROVED' });
const generatePdf = (id: string) =>
  request(app).post(`/api/contracts/${id}/generate-pdf`).set('Authorization', as('RH'));
const consultantSign = (token: string, id: string) =>
  request(app).patch(`/api/contracts/${id}/consultant-sign`).set('Authorization', as(token)).send({});
const reject = (token: string, id: string, reason: string) =>
  request(app).patch(`/api/contracts/${id}/reject`).set('Authorization', as(token)).send({ reason });
const countersign = (token: string, id: string) =>
  request(app).patch(`/api/contracts/${id}/countersign`).set('Authorization', as(token)).send({});

/** Drive a fresh contract for consultant A to PENDING_SIGNATURE with a generated PDF. */
async function pending(consultantId: string, templateId: string): Promise<string> {
  const c = await createContract(consultantId, templateId);
  const id = c.body.id as string;
  await submit(id);
  await validate('RH', id);
  await validate('MANAGER', id);
  await validate('DIRECTION', id);
  await generatePdf(id);
  return id;
}

let ctx: Awaited<ReturnType<typeof seedContext>>;

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  ctx = await seedContext();
});

describe('PATCH /:id/consultant-sign — RBAC + ownership', () => {
  it('CONSULTANT (own) -> 200, stays PENDING_SIGNATURE with consultantSignedAt set', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    const res = await consultantSign('CONSULTANT_A', id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_SIGNATURE');
    expect(res.body.consultantSignedAt).not.toBeNull();
  });

  it("CONSULTANT B on A's contract -> 403 (IDOR blocked)", async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    expect((await consultantSign('CONSULTANT_B', id)).status).toBe(403);
  });

  it('RH -> 403, MANAGER -> 403, DIRECTION -> 403', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    expect((await consultantSign('RH', id)).status).toBe(403);
    expect((await consultantSign('MANAGER', id)).status).toBe(403);
    expect((await consultantSign('DIRECTION', id)).status).toBe(403);
  });

  it('signing twice -> second 409 ALREADY_SIGNED_BY_CONSULTANT', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    expect((await consultantSign('CONSULTANT_A', id)).status).toBe(200);
    const second = await consultantSign('CONSULTANT_A', id);
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe('ALREADY_SIGNED_BY_CONSULTANT');
  });
});

describe('PATCH /:id/reject — CONSULTANT (own)', () => {
  it('own -> 200 → DRAFT, rejectionReason stored, validations gone, resubmittable', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    const res = await reject('CONSULTANT_A', id, 'TJM trop bas');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.rejectionReason).toBe('TJM trop bas');

    const rows = await prisma.contractValidation.count({ where: { contractId: id } });
    expect(rows).toBe(0);
    // Re-submit works and clears the rejection reason.
    expect((await submit(id)).status).toBe(200);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('INTERNAL_VALIDATION');
    expect(after.rejectionReason).toBeNull();
  });

  it("CONSULTANT B rejecting A's contract -> 403", async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    expect((await reject('CONSULTANT_B', id, 'x')).status).toBe(403);
  });

  it('reject after signing -> 409', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    await consultantSign('CONSULTANT_A', id);
    expect((await reject('CONSULTANT_A', id, 'x')).status).toBe(409);
  });
});

describe('PATCH /:id/countersign — RH/DIRECTION', () => {
  it('RH after consultant signed -> 200 SIGNED', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    await consultantSign('CONSULTANT_A', id);
    const res = await countersign('RH', id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SIGNED');
    expect(res.body.companySignedAt).not.toBeNull();
  });

  it('DIRECTION after consultant signed -> 200 SIGNED', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    await consultantSign('CONSULTANT_A', id);
    expect((await countersign('DIRECTION', id)).status).toBe(200);
  });

  it('MANAGER -> 403, CONSULTANT -> 403', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    await consultantSign('CONSULTANT_A', id);
    expect((await countersign('MANAGER', id)).status).toBe(403);
    expect((await countersign('CONSULTANT_A', id)).status).toBe(403);
  });

  it('countersign before the consultant signs -> 409 CONSULTANT_NOT_YET_SIGNED', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    const res = await countersign('RH', id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('CONSULTANT_NOT_YET_SIGNED');
  });
});

describe('GET /api/contracts/mine', () => {
  it('CONSULTANT A -> 200 returns only their own contracts', async () => {
    await pending(ctx.consultantA, ctx.templateId);
    await createContract(ctx.consultantB, ctx.templateId); // B's contract
    const res = await request(app).get('/api/contracts/mine').set('Authorization', as('CONSULTANT_A'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].consultant.id).toBe(ctx.consultantA);
  });

  it('RH -> 403 (consultant-only)', async () => {
    expect((await request(app).get('/api/contracts/mine').set('Authorization', as('RH'))).status).toBe(403);
  });
});

describe('removed endpoint', () => {
  it('PATCH /:id/sign -> 404 (old upload-to-SIGNED path is gone)', async () => {
    const id = await pending(ctx.consultantA, ctx.templateId);
    const res = await request(app)
      .patch(`/api/contracts/${id}/sign`)
      .set('Authorization', as('RH'))
      .send({ signedPdfDocumentId: 'clxxxxxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
  });
});
