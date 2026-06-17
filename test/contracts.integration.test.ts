/**
 * Contracts integration tests — exercises the full middleware stack
 * (auth -> rbac -> ownership -> validate -> controller -> service ->
 * repository -> Postgres) against a REAL database via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. A Postgres instance must be reachable (docker compose up -d postgres) and
 *      DATABASE_URL must point at it (ideally a disposable test schema).
 *   2. All env vars required by src/config/env.ts must be set.
 *   3. The schema must be applied: `npx prisma migrate deploy` (or `db push`).
 *   4. This file lives in `test/` (OUTSIDE the default vitest `include`). Run it
 *      explicitly: npx vitest run test/contracts.integration.test.ts
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
  await prisma.missionAmendment.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.client.deleteMany();
  await prisma.skill.deleteMany();
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

async function seedTemplate() {
  return prisma.contractTemplate.create({
    data: {
      name: 'CDI standard',
      body: 'Contrat {{type}} pour {{firstName}} {{lastName}} ({{position}}) — TJM {{tjm}}.',
      isActive: true,
    },
  });
}

/** A template carrying an extra MANUAL placeholder (`bonus`). */
async function seedTemplateWithManual() {
  return prisma.contractTemplate.create({
    data: {
      name: 'CDI with bonus',
      body: 'Contrat {{type}} pour {{firstName}} {{lastName}} — bonus {{bonus}}.',
      isActive: true,
    },
  });
}

/** Seeds RH/MANAGER/DIRECTION actors + a consultant + a template. */
async function seedActorsAndContext() {
  await seedUser('RH', 'RH');
  await seedUser('MANAGER', 'MANAGER');
  await seedUser('DIRECTION', 'DIRECTION');
  const { consultant } = await seedConsultant('CONSULTANT_A');
  const template = await seedTemplate();
  return { consultantId: consultant.id, templateId: template.id };
}

function createPayload(consultantId: string, templateId?: string) {
  return {
    consultantId,
    ...(templateId ? { templateId } : {}),
    type: 'CDI',
    startDate: new Date('2026-07-01').toISOString(),
  };
}

async function createContract(token: string, consultantId: string, templateId?: string) {
  return request(app)
    .post('/api/contracts')
    .set('Authorization', as(token))
    .send(createPayload(consultantId, templateId));
}

function submit(token: string, id: string) {
  return request(app).patch(`/api/contracts/${id}/submit`).set('Authorization', as(token));
}

function validate(token: string, id: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  return request(app)
    .patch(`/api/contracts/${id}/validate`)
    .set('Authorization', as(token))
    .send({ decision });
}

/** Drives a fresh contract all the way to SIGNED, returning its id. */
async function signedContract(consultantId: string, templateId?: string): Promise<string> {
  const c = await createContract('RH', consultantId, templateId);
  const id = c.body.id as string;
  await submit('RH', id);
  await validate('RH', id);
  await validate('MANAGER', id);
  await validate('DIRECTION', id);

  const rh = await prisma.user.findFirstOrThrow({ where: { role: 'RH' } });
  const doc = await prisma.document.create({
    data: {
      type: 'CONTRACT',
      entityType: 'CONTRACT',
      entityId: id,
      filename: 'signed.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: `contracts/${id}/signed.pdf`,
      uploadedById: rh.id,
    },
  });
  await request(app)
    .patch(`/api/contracts/${id}/sign`)
    .set('Authorization', as('RH'))
    .send({ signedPdfDocumentId: doc.id });
  return id;
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

describe('POST /api/contracts', () => {
  it('RH -> 201 DRAFT with snapshot prefill', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const res = await createContract('RH', consultantId, templateId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', type: 'CDI' });
    expect(res.body.prefilledData.renderedBody).toContain('CONSULTANT_A');
    expect(res.body.consultant.user).toMatchObject({ firstName: 'CONSULTANT_A' });
    expect(res.body.consultant).not.toHaveProperty('keycloakId');
  });

  it('DIRECTION -> 201', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const res = await createContract('DIRECTION', consultantId, templateId);
    expect(res.status).toBe(201);
  });

  it('MANAGER -> 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const res = await createContract('MANAGER', consultantId, templateId);
    expect(res.status).toBe(403);
  });

  it('CONSULTANT -> 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const res = await createContract('CONSULTANT_A', consultantId, templateId);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Submit — RBAC
// ---------------------------------------------------------------------------

describe('PATCH /api/contracts/:id/submit', () => {
  it('RH -> 200 INTERNAL_VALIDATION (3 validation rows created)', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const res = await submit('RH', c.body.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INTERNAL_VALIDATION');
    const rows = await prisma.contractValidation.findMany({ where: { contractId: c.body.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'PENDING')).toBe(true);
  });

  it('MANAGER -> 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const res = await submit('MANAGER', c.body.id);
    expect(res.status).toBe(403);
  });

  it('re-submitting a non-DRAFT contract -> 409', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    await submit('RH', c.body.id);
    const res = await submit('RH', c.body.id);
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Per-step validation RBAC (the security core)
// ---------------------------------------------------------------------------

describe('PATCH /api/contracts/:id/validate — per-step role gate', () => {
  async function submittedContract() {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    await submit('RH', c.body.id);
    return c.body.id as string;
  }

  it('RH step pending: RH 200, MANAGER 403, DIRECTION 403', async () => {
    const id = await submittedContract();
    expect((await validate('MANAGER', id)).status).toBe(403);
    expect((await validate('DIRECTION', id)).status).toBe(403);
    expect((await validate('RH', id)).status).toBe(200);
  });

  it('MANAGER step pending: MANAGER 200, RH 403, DIRECTION 403', async () => {
    const id = await submittedContract();
    await validate('RH', id);
    expect((await validate('RH', id)).status).toBe(403);
    expect((await validate('DIRECTION', id)).status).toBe(403);
    expect((await validate('MANAGER', id)).status).toBe(200);
  });

  it('DIRECTION step pending: DIRECTION 200 -> PENDING_SIGNATURE, RH 403, MANAGER 403', async () => {
    const id = await submittedContract();
    await validate('RH', id);
    await validate('MANAGER', id);
    expect((await validate('RH', id)).status).toBe(403);
    expect((await validate('MANAGER', id)).status).toBe(403);
    const res = await validate('DIRECTION', id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_SIGNATURE');
  });

  it('CONSULTANT cannot validate -> 403', async () => {
    const id = await submittedContract();
    const res = await validate('CONSULTANT_A', id);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Full happy path: create -> submit -> approve x3 -> sign -> archive
// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('create -> submit -> RH/MANAGER/DIRECTION approve -> sign -> archive', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const id = c.body.id as string;

    await submit('RH', id);
    expect((await validate('RH', id)).body.status).toBe('INTERNAL_VALIDATION');
    expect((await validate('MANAGER', id)).body.status).toBe('INTERNAL_VALIDATION');
    expect((await validate('DIRECTION', id)).body.status).toBe('PENDING_SIGNATURE');

    // Documents module would normally create this Document row.
    const rh = await prisma.user.findFirstOrThrow({ where: { role: 'RH' } });
    const doc = await prisma.document.create({
      data: {
        type: 'CONTRACT',
        entityType: 'CONTRACT',
        entityId: id,
        filename: 'signed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `contracts/${id}/signed.pdf`,
        uploadedById: rh.id,
      },
    });

    const signed = await request(app)
      .patch(`/api/contracts/${id}/sign`)
      .set('Authorization', as('RH'))
      .send({ signedPdfDocumentId: doc.id });
    expect(signed.status).toBe(200);
    expect(signed.body.status).toBe('SIGNED');
    expect(signed.body.signedPdfId).toBe(doc.id);

    const archived = await request(app)
      .patch(`/api/contracts/${id}/archive`)
      .set('Authorization', as('RH'));
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');
    expect(archived.body.archivedAt).not.toBeNull();
  });

  it('sign rejects a Document that does not belong to the contract -> 400', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const id = c.body.id as string;
    await submit('RH', id);
    await validate('RH', id);
    await validate('MANAGER', id);
    await validate('DIRECTION', id);

    const rh = await prisma.user.findFirstOrThrow({ where: { role: 'RH' } });
    const doc = await prisma.document.create({
      data: {
        type: 'CONTRACT',
        entityType: 'CONTRACT',
        entityId: 'some-other-contract-id',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storageKey: `contracts/other/signed.pdf`,
        uploadedById: rh.id,
      },
    });
    const res = await request(app)
      .patch(`/api/contracts/${id}/sign`)
      .set('Authorization', as('RH'))
      .send({ signedPdfDocumentId: doc.id });
    expect(res.status).toBe(400);
  });

  it('sign rejects a soft-deleted (archived) CONTRACT Document -> 400, stays unsigned', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const id = c.body.id as string;
    await submit('RH', id);
    await validate('RH', id);
    await validate('MANAGER', id);
    await validate('DIRECTION', id);

    const rh = await prisma.user.findFirstOrThrow({ where: { role: 'RH' } });
    const doc = await prisma.document.create({
      data: {
        type: 'CONTRACT',
        entityType: 'CONTRACT',
        entityId: id,
        filename: 'signed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `contracts/${id}/signed.pdf`,
        uploadedById: rh.id,
        archivedAt: new Date(),
      },
    });

    const res = await request(app)
      .patch(`/api/contracts/${id}/sign`)
      .set('Authorization', as('RH'))
      .send({ signedPdfDocumentId: doc.id });
    expect(res.status).toBe(400);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(row.status).not.toBe('SIGNED');
    expect(row.signedPdfId).toBeNull();
  });

  it('archive is idempotent', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const first = await request(app)
      .patch(`/api/contracts/${c.body.id}/archive`)
      .set('Authorization', as('RH'));
    expect(first.status).toBe(200);
    const second = await request(app)
      .patch(`/api/contracts/${c.body.id}/archive`)
      .set('Authorization', as('RH'));
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('ARCHIVED');
  });
});

// ---------------------------------------------------------------------------
// Reject path
// ---------------------------------------------------------------------------

describe('reject path', () => {
  it('MANAGER rejects after RH approves -> DRAFT, rows gone, editable, resubmittable', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const id = c.body.id as string;

    await submit('RH', id);
    await validate('RH', id);
    const rejected = await validate('MANAGER', id, 'REJECTED');
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('DRAFT');

    const rows = await prisma.contractValidation.findMany({ where: { contractId: id } });
    expect(rows).toHaveLength(0);

    // Editable again.
    const edited = await request(app)
      .patch(`/api/contracts/${id}`)
      .set('Authorization', as('RH'))
      .send({ type: 'CDD' });
    expect(edited.status).toBe(200);
    expect(edited.body.type).toBe('CDD');

    // Resubmittable -> fresh rows.
    const resub = await submit('RH', id);
    expect(resub.status).toBe(200);
    expect(resub.body.status).toBe('INTERNAL_VALIDATION');
    const freshRows = await prisma.contractValidation.findMany({ where: { contractId: id } });
    expect(freshRows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// CONSULTANT own-contract read (IDOR)
// ---------------------------------------------------------------------------

describe('GET /api/contracts/:id — CONSULTANT ownership', () => {
  it('own contract -> 200; other consultant -> 403', async () => {
    await seedUser('RH', 'RH');
    const { consultant: conA } = await seedConsultant('CONSULTANT_A');
    await seedConsultant('CONSULTANT_B');
    const template = await seedTemplate();

    const created = await createContract('RH', conA.id, template.id);
    const id = created.body.id as string;

    const own = await request(app)
      .get(`/api/contracts/${id}`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id });

    const other = await request(app)
      .get(`/api/contracts/${id}`)
      .set('Authorization', as('CONSULTANT_B'));
    expect(other.status).toBe(403);

    // RH (privileged) can read it too.
    const rh = await request(app).get(`/api/contracts/${id}`).set('Authorization', as('RH'));
    expect(rh.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('GET /api/contracts', () => {
  it('RH -> 200 with pagination envelope; CONSULTANT -> 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    await createContract('RH', consultantId, templateId);

    const res = await request(app).get('/api/contracts').set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(res.body.total).toBe(1);

    const forbidden = await request(app)
      .get('/api/contracts')
      .set('Authorization', as('CONSULTANT_A'));
    expect(forbidden.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Amendments — RBAC
// ---------------------------------------------------------------------------

describe('contract amendments', () => {
  function amendmentPayload() {
    return {
      reason: 'TJM increase',
      changes: { tjm: { from: '500.00', to: '550.00' } },
      effectiveDate: new Date('2026-09-01').toISOString(),
    };
  }

  it('RH=201, DIRECTION=201, MANAGER=403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const id = await signedContract(consultantId, templateId);

    const rh = await request(app)
      .post(`/api/contracts/${id}/amendments`)
      .set('Authorization', as('RH'))
      .send(amendmentPayload());
    expect(rh.status).toBe(201);
    expect(rh.body.createdById).toBeTruthy();

    const dir = await request(app)
      .post(`/api/contracts/${id}/amendments`)
      .set('Authorization', as('DIRECTION'))
      .send(amendmentPayload());
    expect(dir.status).toBe(201);

    const mgr = await request(app)
      .post(`/api/contracts/${id}/amendments`)
      .set('Authorization', as('MANAGER'))
      .send(amendmentPayload());
    expect(mgr.status).toBe(403);
  });

  it('list amendments: RH/MANAGER/DIRECTION 200, CONSULTANT 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const id = await signedContract(consultantId, templateId);
    await request(app)
      .post(`/api/contracts/${id}/amendments`)
      .set('Authorization', as('RH'))
      .send(amendmentPayload());

    for (const role of ['RH', 'MANAGER', 'DIRECTION']) {
      const res = await request(app)
        .get(`/api/contracts/${id}/amendments`)
        .set('Authorization', as(role));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    }

    const consultant = await request(app)
      .get(`/api/contracts/${id}/amendments`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(consultant.status).toBe(403);
  });

  it('amendment on a non-SIGNED (DRAFT) contract -> 400', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const c = await createContract('RH', consultantId, templateId);
    const res = await request(app)
      .post(`/api/contracts/${c.body.id}/amendments`)
      .set('Authorization', as('RH'))
      .send(amendmentPayload());
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Manual fields + in-app PDF generation (D-FORM + D3)
// ---------------------------------------------------------------------------

describe('POST /api/contracts/:id/generate-pdf', () => {
  /** Drive a contract (created with a complete `fields` map) to PENDING_SIGNATURE. */
  async function readyContract(consultantId: string, templateId: string, fields: Record<string, string>) {
    const created = await request(app)
      .post('/api/contracts')
      .set('Authorization', as('RH'))
      .send({ consultantId, templateId, type: 'CDI', fields });
    const id = created.body.id as string;
    await submit('RH', id);
    await validate('RH', id);
    await validate('MANAGER', id);
    await validate('DIRECTION', id);
    return id;
  }

  it('generates a PDF Document for a complete contract -> 201 (no storageKey leaked)', async () => {
    await seedUser('RH', 'RH');
    await seedUser('MANAGER', 'MANAGER');
    await seedUser('DIRECTION', 'DIRECTION');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const template = await seedTemplateWithManual();

    const id = await readyContract(consultant.id, template.id, { bonus: '5000' });

    const res = await request(app)
      .post(`/api/contracts/${id}/generate-pdf`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({
      type: 'CONTRACT',
      entityType: 'CONTRACT',
      entityId: id,
      mimeType: 'application/pdf',
    });
    expect(res.body.document).not.toHaveProperty('storageKey');

    // generatedPdfId is now pointed at the new Document.
    const row = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(row.generatedPdfId).toBe(res.body.document.id);

    // The generated Document is downloadable via the Documents module.
    const url = await request(app)
      .get(`/api/documents/${res.body.document.id}/url`)
      .set('Authorization', as('RH'));
    expect(url.status).toBe(200);
  });

  it('rejects generation when a manual placeholder is unfilled -> 400 INCOMPLETE_CONTRACT', async () => {
    await seedUser('RH', 'RH');
    await seedUser('MANAGER', 'MANAGER');
    await seedUser('DIRECTION', 'DIRECTION');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const template = await seedTemplateWithManual();

    // No `bonus` provided -> the placeholder stays unfilled.
    const id = await readyContract(consultant.id, template.id, {});

    const res = await request(app)
      .post(`/api/contracts/${id}/generate-pdf`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('INCOMPLETE_CONTRACT');
    expect(res.body.error.details.unfilled).toContain('bonus');
  });

  it('rejects generation on a DRAFT contract -> 400 CONTRACT_NOT_READY', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const created = await createContract('RH', consultantId, templateId);
    const res = await request(app)
      .post(`/api/contracts/${created.body.id}/generate-pdf`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('CONTRACT_NOT_READY');
  });

  it('MANAGER cannot generate -> 403', async () => {
    const { consultantId, templateId } = await seedActorsAndContext();
    const created = await createContract('RH', consultantId, templateId);
    const res = await request(app)
      .post(`/api/contracts/${created.body.id}/generate-pdf`)
      .set('Authorization', as('MANAGER'));
    expect(res.status).toBe(403);
  });
});
