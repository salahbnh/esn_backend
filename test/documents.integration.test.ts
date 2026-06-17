/**
 * Documents integration tests — the full middleware stack (auth -> rbac ->
 * validate -> controller -> service -> access -> repository -> Postgres) AND a
 * REAL MinIO/S3 backend, via supertest + buildApp().
 *
 * SETUP / ENV ASSUMPTIONS (the harness owner runs this, not the unit runner):
 *   1. Postgres reachable; DATABASE_URL set (ideally a disposable test schema).
 *   2. MinIO reachable; S3_* env set; bucket `esn-documents` created
 *      (docker compose up -d minio + the minio-setup job).
 *   3. Schema applied: `npx prisma migrate deploy` (must include add_document_archived_at).
 *   4. This file lives in `test/` (OUTSIDE the default vitest include). Run it with:
 *      npx vitest run test/documents.integration.test.ts
 *
 * What is mocked: `src/lib/keycloak.js#verifyToken`. The Bearer token string is
 * the application role; the DB + MinIO are real and reset between tests.
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
const PDF = Buffer.from('%PDF-1.4 test');

function as(token: string) {
  return `Bearer ${token}`;
}

async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.contractValidation.deleteMany();
  await prisma.contractAmendment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.client.deleteMany();
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

function uploadCv(token: string, entityId: string, filename = 'cv.pdf', type = 'CV') {
  return request(app)
    .post('/api/documents/upload')
    .set('Authorization', as(token))
    .field('type', type)
    .field('entityType', 'CONSULTANT')
    .field('entityId', entityId)
    .attach('file', PDF, { filename, contentType: 'application/pdf' });
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
// Upload + download round-trip
// ---------------------------------------------------------------------------

describe('upload + download', () => {
  it('RH uploads a CV for a consultant -> 201 with NO storageKey', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');

    const res = await uploadCv('RH', consultant.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'CV',
      entityType: 'CONSULTANT',
      entityId: consultant.id,
      filename: 'cv.pdf',
      mimeType: 'application/pdf',
    });
    expect(res.body).not.toHaveProperty('storageKey');
  });

  it('GET /:id/url returns { url, expiresAt } (no storageKey)', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const up = await uploadCv('RH', consultant.id);

    const res = await request(app)
      .get(`/api/documents/${up.body.id}/url`)
      .set('Authorization', as('RH'));
    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
    expect(typeof res.body.expiresAt).toBe('string');
    expect(res.body).not.toHaveProperty('storageKey');
  });

  it('path-traversal filename is accepted and stored sanitized', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');

    const res = await uploadCv('RH', consultant.id, '../../etc/passwd.pdf');
    expect(res.status).toBe(201);
    const row = await prisma.document.findUnique({ where: { id: res.body.id } });
    expect(row?.storageKey).not.toContain('..');
    expect(row?.storageKey).not.toContain('/etc/');
    expect(row?.storageKey).toContain('passwd.pdf');
  });
});

// ---------------------------------------------------------------------------
// IDOR
// ---------------------------------------------------------------------------

describe('IDOR — consultant document access', () => {
  it('consultant A uploads own CV; A reads url 200, B reads url 403', async () => {
    const { consultant: conA } = await seedConsultant('CONSULTANT_A');
    await seedConsultant('CONSULTANT_B');

    const up = await uploadCv('CONSULTANT_A', conA.id);
    expect(up.status).toBe(201);

    const aRead = await request(app)
      .get(`/api/documents/${up.body.id}/url`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(aRead.status).toBe(200);

    const bRead = await request(app)
      .get(`/api/documents/${up.body.id}/url`)
      .set('Authorization', as('CONSULTANT_B'));
    expect(bRead.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation: mime + size + role
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('bad mime (text/plain as CV) -> 400 BAD_MIME', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', as('RH'))
      .field('type', 'CV')
      .field('entityType', 'CONSULTANT')
      .field('entityId', consultant.id)
      .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.details?.code).toBe('BAD_MIME');
  });

  it('oversize file (>20MB) -> 413', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0x25); // 20MB + 1 byte

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', as('RH'))
      .field('type', 'CV')
      .field('entityType', 'CONSULTANT')
      .field('entityId', consultant.id)
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(413);
  });

  it('CONSULTANT uploading a CONTRACT doc -> 403', async () => {
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', as('CONSULTANT_A'))
      .field('type', 'CONTRACT')
      .field('entityType', 'CONTRACT')
      .field('entityId', consultant.id) // entityId shape is fine; role gate fires first
      .attach('file', PDF, { filename: 'k.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Soft-delete + restore
// ---------------------------------------------------------------------------

describe('soft-delete + restore', () => {
  it('RH deletes -> 204; url now 404; restore -> url works again', async () => {
    await seedUser('RH', 'RH');
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const up = await uploadCv('RH', consultant.id);

    const del = await request(app)
      .delete(`/api/documents/${up.body.id}`)
      .set('Authorization', as('RH'));
    expect(del.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/api/documents/${up.body.id}/url`)
      .set('Authorization', as('RH'));
    expect(afterDelete.status).toBe(404);

    const restore = await request(app)
      .post(`/api/documents/${up.body.id}/restore`)
      .set('Authorization', as('RH'));
    expect(restore.status).toBe(200);

    const afterRestore = await request(app)
      .get(`/api/documents/${up.body.id}/url`)
      .set('Authorization', as('RH'));
    expect(afterRestore.status).toBe(200);
  });

  it('CONSULTANT cannot delete -> 403', async () => {
    const { consultant } = await seedConsultant('CONSULTANT_A');
    const up = await uploadCv('CONSULTANT_A', consultant.id);

    const del = await request(app)
      .delete(`/api/documents/${up.body.id}`)
      .set('Authorization', as('CONSULTANT_A'));
    expect(del.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// List scoping
// ---------------------------------------------------------------------------

describe('list scoping', () => {
  it('consultant A lists own entity -> only theirs; B for A entity -> 403', async () => {
    const { consultant: conA } = await seedConsultant('CONSULTANT_A');
    await seedConsultant('CONSULTANT_B');
    await uploadCv('CONSULTANT_A', conA.id);

    const aList = await request(app)
      .get('/api/documents')
      .query({ entityType: 'CONSULTANT', entityId: conA.id })
      .set('Authorization', as('CONSULTANT_A'));
    expect(aList.status).toBe(200);
    expect(aList.body.total).toBe(1);
    expect(aList.body.data[0]).not.toHaveProperty('storageKey');

    const bList = await request(app)
      .get('/api/documents')
      .query({ entityType: 'CONSULTANT', entityId: conA.id })
      .set('Authorization', as('CONSULTANT_B'));
    expect(bList.status).toBe(403);
  });
});
