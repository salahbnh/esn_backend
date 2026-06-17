import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../lib/app-error.js';

// Mock the repository so the access matrix is tested in isolation.
vi.mock('./documents.repository.js', () => ({
  resolveConsultantOwnerUserId: vi.fn(),
  resolveContractOwnerUserId: vi.fn(),
  resolveAssignmentOwnerUserId: vi.fn(),
  findConsultantIdByUserId: vi.fn(),
  consultantHasMissionAssignment: vi.fn(),
}));

import * as repo from './documents.repository.js';
import { assertCanDelete, assertCanDownload, assertCanUpload } from './documents.access.js';
import type { AccessUser } from './documents.access.js';

const RH: AccessUser = { id: 'u-rh', role: 'RH' };
const MANAGER: AccessUser = { id: 'u-mgr', role: 'MANAGER' };
const DIRECTION: AccessUser = { id: 'u-dir', role: 'DIRECTION' };
const CONS_A: AccessUser = { id: 'u-a', role: 'CONSULTANT' };
const CONS_B: AccessUser = { id: 'u-b', role: 'CONSULTANT' };

const mocked = vi.mocked(repo);

async function status(fn: () => Promise<void> | void): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (err) {
    return (err as AppError).statusCode;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe('assertCanUpload', () => {
  it('RH may upload CV to a CONSULTANT entity', async () => {
    expect(await status(() => assertCanUpload(RH, 'CONSULTANT', 'c1', 'CV'))).toBe(200);
  });

  it('CONSULTANT may upload own CV to own CONSULTANT entity', async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_A.id);
    expect(await status(() => assertCanUpload(CONS_A, 'CONSULTANT', 'c-a', 'CV'))).toBe(200);
  });

  it('CONSULTANT may upload an OTHER doc to own CONSULTANT entity', async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_A.id);
    expect(await status(() => assertCanUpload(CONS_A, 'CONSULTANT', 'c-a', 'OTHER'))).toBe(200);
  });

  it("CONSULTANT cannot upload an OTHER doc to another's CONSULTANT entity -> 403", async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_B.id);
    expect(await status(() => assertCanUpload(CONS_A, 'CONSULTANT', 'c-b', 'OTHER'))).toBe(403);
  });

  it("CONSULTANT cannot upload to another consultant's entity -> 403", async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_B.id);
    expect(await status(() => assertCanUpload(CONS_A, 'CONSULTANT', 'c-b', 'CV'))).toBe(403);
  });

  it('CONSULTANT cannot upload a CONTRACT doc -> 403', async () => {
    expect(await status(() => assertCanUpload(CONS_A, 'CONTRACT', 'k1', 'CONTRACT'))).toBe(403);
  });

  it('CONSULTANT cannot upload a non-CV/OTHER type to own entity -> 403', async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_A.id);
    expect(await status(() => assertCanUpload(CONS_A, 'CONSULTANT', 'c-a', 'CONTRACT'))).toBe(403);
  });

  it('MANAGER cannot upload a CONTRACT doc -> 403', async () => {
    expect(await status(() => assertCanUpload(MANAGER, 'CONTRACT', 'k1', 'CONTRACT'))).toBe(403);
  });

  it('MANAGER may upload a MISSION_DOC to a MISSION', async () => {
    expect(await status(() => assertCanUpload(MANAGER, 'MISSION', 'm1', 'MISSION_DOC'))).toBe(200);
  });

  it('RH may upload a CONTRACT doc to a CONTRACT', async () => {
    expect(await status(() => assertCanUpload(RH, 'CONTRACT', 'k1', 'CONTRACT'))).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Download (incl. IDOR)
// ---------------------------------------------------------------------------

describe('assertCanDownload', () => {
  it('RH may download a CONSULTANT doc', async () => {
    expect(await status(() => assertCanDownload(RH, { entityType: 'CONSULTANT', entityId: 'c1' }))).toBe(200);
  });

  it('DIRECTION may download a CONTRACT_TEMPLATE doc', async () => {
    expect(
      await status(() => assertCanDownload(DIRECTION, { entityType: 'CONTRACT_TEMPLATE', entityId: 't1' })),
    ).toBe(200);
  });

  it('CONSULTANT may download own CONSULTANT doc', async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_A.id);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'CONSULTANT', entityId: 'c-a' }))).toBe(200);
  });

  it("CONSULTANT cannot download another's CONSULTANT doc -> 403 (IDOR)", async () => {
    mocked.resolveConsultantOwnerUserId.mockResolvedValue(CONS_B.id);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'CONSULTANT', entityId: 'c-b' }))).toBe(403);
  });

  it("CONSULTANT cannot download a CONTRACT doc they don't own -> 403", async () => {
    mocked.resolveContractOwnerUserId.mockResolvedValue(CONS_B.id);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'CONTRACT', entityId: 'k1' }))).toBe(403);
  });

  it('CONSULTANT may download own CONTRACT doc', async () => {
    mocked.resolveContractOwnerUserId.mockResolvedValue(CONS_A.id);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'CONTRACT', entityId: 'k1' }))).toBe(200);
  });

  it('CONSULTANT may download a MISSION doc for an assigned mission', async () => {
    mocked.findConsultantIdByUserId.mockResolvedValue('cons-a');
    mocked.consultantHasMissionAssignment.mockResolvedValue(true);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'MISSION', entityId: 'm1' }))).toBe(200);
  });

  it('CONSULTANT cannot download a MISSION doc for an unassigned mission -> 403', async () => {
    mocked.findConsultantIdByUserId.mockResolvedValue('cons-a');
    mocked.consultantHasMissionAssignment.mockResolvedValue(false);
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'MISSION', entityId: 'm1' }))).toBe(403);
  });

  it('CONSULTANT cannot download a CANDIDATE doc -> 403', async () => {
    expect(await status(() => assertCanDownload(CONS_A, { entityType: 'CANDIDATE', entityId: 'cand1' }))).toBe(403);
  });

  it('CONSULTANT cannot download a CLIENT doc -> 403', async () => {
    expect(await status(() => assertCanDownload(CONS_B, { entityType: 'CLIENT', entityId: 'cl1' }))).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe('assertCanDelete', () => {
  const ref = { entityType: 'CONSULTANT' as const, entityId: 'c1' };

  it('RH may delete', async () => {
    expect(await status(() => assertCanDelete(RH, ref))).toBe(200);
  });
  it('DIRECTION may delete', async () => {
    expect(await status(() => assertCanDelete(DIRECTION, ref))).toBe(200);
  });
  it('MANAGER cannot delete -> 403', async () => {
    expect(await status(() => assertCanDelete(MANAGER, ref))).toBe(403);
  });
  it('CONSULTANT cannot delete -> 403', async () => {
    expect(await status(() => assertCanDelete(CONS_A, ref))).toBe(403);
  });
});
