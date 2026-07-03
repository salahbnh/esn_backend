/**
 * PUBLIC application portal integration tests — the unauthenticated surface.
 * Covers token gating (404/410), the hardened apply (magic bytes, honeypot,
 * dynamic validation, consent), Application/Document creation with NO Candidate,
 * and per-IP rate limiting. Real Postgres + real MinIO.
 *   npx vitest run --config vitest.integration.config.ts test/public-jobs.integration.test.ts
 *
 * A fresh app is built per test so each starts with clean in-memory rate limits.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let app: ReturnType<typeof buildApp>;

// Minimal valid PDF (file-type detects the %PDF signature) and a non-PDF blob.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const TXT = Buffer.from('just some plain text, not a pdf at all');

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

async function seedAuthor() {
  return prisma.user.create({
    data: { keycloakId: 'kc-RH', email: 'rh@internal.test', firstName: 'RH', lastName: 'User', role: 'RH' },
  });
}

async function seedJob(
  authorId: string,
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED',
  token: string,
) {
  return prisma.jobPost.create({
    data: {
      title: 'Dev Full-Stack',
      description: 'Build things',
      employmentType: 'CDI',
      status,
      publicToken: token,
      ...(status !== 'DRAFT' ? { publishedAt: new Date() } : {}),
      authorId,
      questions: {
        create: [{ key: 'yrs', label: 'Years', type: 'NUMBER', required: true, order: 0 }],
      },
    },
  });
}

function applyReq(token: string) {
  return request(app)
    .post(`/api/public/jobs/${token}/apply`)
    .field('firstName', 'Jane')
    .field('lastName', 'Doe')
    .field('email', 'jane@ext.test')
    .field('consentAccepted', 'true')
    .field('answers', JSON.stringify({ yrs: 5 }))
    .field('declaredSkillNames', JSON.stringify(['React']));
}

beforeEach(async () => {
  app = buildApp();
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('GET /api/public/jobs/:token (gating)', () => {
  it('PUBLISHED -> 200 minimal shape (no internal id / authorId)', async () => {
    const author = await seedAuthor();
    await seedJob(author.id, 'PUBLISHED', 'tok-published-000001');
    const res = await request(app).get('/api/public/jobs/tok-published-000001');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Dev Full-Stack', token: 'tok-published-000001' });
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('authorId');
    expect(res.body.questions).toHaveLength(1);
  });

  it('DRAFT -> 404 (no existence oracle)', async () => {
    const author = await seedAuthor();
    await seedJob(author.id, 'DRAFT', 'tok-draft-000001');
    expect((await request(app).get('/api/public/jobs/tok-draft-000001')).status).toBe(404);
  });

  it('CLOSED -> 410', async () => {
    const author = await seedAuthor();
    await seedJob(author.id, 'CLOSED', 'tok-closed-000001');
    expect((await request(app).get('/api/public/jobs/tok-closed-000001')).status).toBe(410);
  });

  it('unknown token -> 404', async () => {
    expect((await request(app).get('/api/public/jobs/tok-nope-000001')).status).toBe(404);
  });
});

describe('POST /api/public/jobs/:token/apply (hardening)', () => {
  async function published() {
    const author = await seedAuthor();
    await prisma.skill.create({ data: { name: 'React' } });
    return seedJob(author.id, 'PUBLISHED', 'tok-apply-000001');
  }

  it('happy path -> 202, Application(SUBMITTED) + Document(PENDING, no uploader), NO Candidate', async () => {
    await published();
    const res = await applyReq('tok-apply-000001').attach('cv', PDF, {
      filename: 'cv.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(202);
    expect(typeof res.body.referenceId).toBe('string');

    const apps = await prisma.application.findMany({ include: { candidate: true } });
    expect(apps).toHaveLength(1);
    expect(apps[0]!.status).toBe('SUBMITTED');
    expect(apps[0]!.candidateId).toBeNull();
    expect(await prisma.candidate.count()).toBe(0); // no Candidate at apply

    const docs = await prisma.document.findMany({ where: { entityType: 'APPLICATION' } });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.type).toBe('CV');
    expect(docs[0]!.uploadedById).toBeNull();
    expect(docs[0]!.scanStatus).toBe('PENDING');
    // declared skill matched the catalogue and was snapshotted
    expect(apps[0]!.declaredSkills).toEqual([{ name: 'React' }]);
  });

  it('honeypot filled -> fake 202, nothing written', async () => {
    await published();
    const res = await applyReq('tok-apply-000001')
      .field('hp_website', 'http://spam.example')
      .attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    expect(await prisma.application.count()).toBe(0);
  });

  it('non-PDF/DOCX content (magic-byte mismatch) -> 400', async () => {
    await published();
    const res = await applyReq('tok-apply-000001').attach('cv', TXT, {
      filename: 'cv.pdf', // lying extension/mimetype
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('INVALID_FILE_TYPE');
  });

  it('missing CV -> 400', async () => {
    await published();
    const res = await applyReq('tok-apply-000001'); // no .attach
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('CV_REQUIRED');
  });

  it('unknown answer key -> 400', async () => {
    await published();
    const res = await request(app)
      .post('/api/public/jobs/tok-apply-000001/apply')
      .field('firstName', 'Jane')
      .field('lastName', 'Doe')
      .field('email', 'jane@ext.test')
      .field('consentAccepted', 'true')
      .field('answers', JSON.stringify({ nope: 'x', yrs: 5 }))
      .attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('UNKNOWN_ANSWER_KEY');
  });

  it('applying to a CLOSED job -> 410', async () => {
    const author = await seedAuthor();
    await seedJob(author.id, 'CLOSED', 'tok-closed-apply');
    const res = await applyReq('tok-closed-apply').attach('cv', PDF, {
      filename: 'cv.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(410);
  });
});

describe('rate limiting (per-IP apply)', () => {
  it('returns 429 after exceeding the per-IP apply limit', async () => {
    const author = await seedAuthor();
    await seedJob(author.id, 'PUBLISHED', 'tok-rate-000001');
    // Default PUBLIC_RATE_LIMIT_APPLY_IP_MAX = 5. The 6th apply from the same IP -> 429.
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await applyReq('tok-rate-000001').attach('cv', PDF, {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
