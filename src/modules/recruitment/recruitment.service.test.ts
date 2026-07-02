import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/app-error.js';

// Mock the repository and the Keycloak admin client. The service is tested in
// isolation — no database, no network.
vi.mock('./recruitment.repository.js');
// Explicit factory so the real keycloak-admin module (and its env-validating
// config import, which calls process.exit on missing env) is never evaluated.
vi.mock('../../lib/keycloak-admin.js', () => ({
  provisionUser: vi.fn(),
  deleteUser: vi.fn(),
  activateUser: vi.fn(),
  checkKeycloakUsernameExists: vi.fn(),
}));
// Stub the logger so importing the service doesn't pull in the env-validating
// config module (which calls process.exit on missing env in the unit runner).
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// The service now imports config directly (for COMPANY_EMAIL_DOMAIN). Mock it so
// the unit runner never evaluates env.ts (which calls process.exit on missing env).
vi.mock('../../config/env.js', () => ({
  config: { COMPANY_EMAIL_DOMAIN: 'esn.local', KEYCLOAK_FRONTEND_CLIENT_ID: 'esn-frontend' },
}));

import * as repo from './recruitment.repository.js';
import {
  provisionUser,
  deleteUser,
  activateUser,
  checkKeycloakUsernameExists,
} from '../../lib/keycloak-admin.js';
import * as service from './recruitment.service.js';

const mockRepo = vi.mocked(repo);
const mockProvision = vi.mocked(provisionUser);
const mockDelete = vi.mocked(deleteUser);
const mockActivate = vi.mocked(activateUser);
const mockCheckKc = vi.mocked(checkKeycloakUsernameExists);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    status: 'APPLIED',
    source: null,
    targetPosition: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
  // Default: the generated company email is free in both DB and Keycloak, so the
  // collision loop breaks on the first iteration. Individual tests override these.
  mockRepo.findUserByEmail.mockResolvedValue(null);
  mockCheckKc.mockResolvedValue(false);
});

// ---------------------------------------------------------------------------
// Create — duplicate email
// ---------------------------------------------------------------------------

describe('createCandidate', () => {
  it('throws 409 when email already exists', async () => {
    mockRepo.findCandidateByEmail.mockResolvedValue({ id: 'other' });
    await expect(
      service.createCandidate(
        { firstName: 'A', lastName: 'B', email: 'ada@example.com' },
        'actor1',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRepo.createCandidate).not.toHaveBeenCalled();
  });

  it('creates and writes an audit log on success', async () => {
    mockRepo.findCandidateByEmail.mockResolvedValue(null);
    mockRepo.createCandidate.mockResolvedValue(candidate());
    const result = await service.createCandidate(
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      'actor1',
    );
    expect(result).toMatchObject({ id: 'cand1' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', actorId: 'actor1', entityType: 'CANDIDATE' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

describe('transitionStatus', () => {
  it('APPLIED -> INTERVIEW succeeds', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'APPLIED' }));
    mockRepo.updateCandidateStatus.mockResolvedValue(candidate({ status: 'INTERVIEW' }));
    const result = await service.transitionStatus('cand1', 'INTERVIEW', 'ok', 'actor1');
    expect(result).toMatchObject({ status: 'INTERVIEW' });
    expect(mockRepo.updateCandidateStatus).toHaveBeenCalledWith('cand1', 'INTERVIEW');
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STATUS_CHANGE' }),
    );
  });

  it('APPLIED -> VALIDATED throws INVALID_TRANSITION (400)', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'APPLIED' }));
    await expect(
      service.transitionStatus('cand1', 'VALIDATED', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.updateCandidateStatus).not.toHaveBeenCalled();
  });

  it('INTERVIEW -> VALIDATED succeeds', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'INTERVIEW' }));
    mockRepo.updateCandidateStatus.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    const result = await service.transitionStatus('cand1', 'VALIDATED', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'VALIDATED' });
  });

  it('INTERVIEW -> APPLIED (backward) throws 400', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'INTERVIEW' }));
    await expect(
      service.transitionStatus('cand1', 'APPLIED', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('VALIDATED -> REJECTED succeeds', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.updateCandidateStatus.mockResolvedValue(candidate({ status: 'REJECTED' }));
    const result = await service.transitionStatus('cand1', 'REJECTED', undefined, 'actor1');
    expect(result).toMatchObject({ status: 'REJECTED' });
  });

  it('VALIDATED -> HIRED is rejected (must use convert) with 400', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    await expect(
      service.transitionStatus('cand1', 'HIRED', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.updateCandidateStatus).not.toHaveBeenCalled();
  });

  it('REJECTED -> anything throws 400 (terminal)', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'REJECTED' }));
    await expect(
      service.transitionStatus('cand1', 'INTERVIEW', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('HIRED -> anything throws 400 (terminal)', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'HIRED' }));
    await expect(
      service.transitionStatus('cand1', 'REJECTED', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 when candidate not found', async () => {
    mockRepo.findCandidateById.mockResolvedValue(null);
    await expect(
      service.transitionStatus('missing', 'INTERVIEW', undefined, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Proposal status transitions
// ---------------------------------------------------------------------------

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop1',
    candidateId: 'cand1',
    status: 'DRAFT',
    content: {},
    documentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

describe('updateProposalStatus', () => {
  beforeEach(() => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
  });

  it('DRAFT -> SENT succeeds and writes an audit log', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ status: 'DRAFT' }));
    mockRepo.updateProposalStatus.mockResolvedValue(proposal({ status: 'SENT' }));
    const result = await service.updateProposalStatus('cand1', 'prop1', 'SENT', 'actor1');
    expect(result).toMatchObject({ status: 'SENT' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        actorId: 'actor1',
        entityType: 'CANDIDATE',
        entityId: 'cand1',
      }),
    );
  });

  it('SENT -> ACCEPTED succeeds', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ status: 'SENT' }));
    mockRepo.updateProposalStatus.mockResolvedValue(proposal({ status: 'ACCEPTED' }));
    const result = await service.updateProposalStatus('cand1', 'prop1', 'ACCEPTED', 'actor1');
    expect(result).toMatchObject({ status: 'ACCEPTED' });
  });

  it('SENT -> DECLINED succeeds', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ status: 'SENT' }));
    mockRepo.updateProposalStatus.mockResolvedValue(proposal({ status: 'DECLINED' }));
    const result = await service.updateProposalStatus('cand1', 'prop1', 'DECLINED', 'actor1');
    expect(result).toMatchObject({ status: 'DECLINED' });
  });

  it('ACCEPTED -> DRAFT throws 400 (backward)', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ status: 'ACCEPTED' }));
    await expect(
      service.updateProposalStatus('cand1', 'prop1', 'DRAFT', 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('DRAFT -> ACCEPTED throws 400 (skip)', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ status: 'DRAFT' }));
    await expect(
      service.updateProposalStatus('cand1', 'prop1', 'ACCEPTED', 'actor1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 when proposal belongs to another candidate', async () => {
    mockRepo.findProposalById.mockResolvedValue(proposal({ candidateId: 'other' }));
    await expect(
      service.updateProposalStatus('cand1', 'prop1', 'SENT', 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Interactions — audit
// ---------------------------------------------------------------------------

describe('addInteraction', () => {
  it('creates an interaction and writes an audit log', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'APPLIED' }));
    mockRepo.createInteraction.mockResolvedValue({
      id: 'int1',
      candidateId: 'cand1',
      type: 'NOTE',
    } as never);
    const result = await service.addInteraction(
      'cand1',
      { type: 'NOTE', occurredAt: new Date().toISOString(), summary: 'hi' },
      'author1',
    );
    expect(result).toMatchObject({ id: 'int1' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        actorId: 'author1',
        entityType: 'CANDIDATE',
        entityId: 'cand1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Proposals — create audit
// ---------------------------------------------------------------------------

describe('createProposal', () => {
  it('creates a proposal and writes an audit log', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'APPLIED' }));
    mockRepo.createProposal.mockResolvedValue(proposal({ status: 'DRAFT' }));
    const result = await service.createProposal('cand1', { content: { x: 1 } }, 'actor1');
    expect(result).toMatchObject({ status: 'DRAFT' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        actorId: 'actor1',
        entityType: 'CANDIDATE',
        entityId: 'cand1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

describe('convertToConsultant', () => {
  const body = { position: 'Backend Engineer' };

  it('throws 404 when candidate not found', async () => {
    mockRepo.findCandidateById.mockResolvedValue(null);
    await expect(service.convertToConsultant('missing', body, 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('throws 400 when candidate is not VALIDATED', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'INTERVIEW' }));
    await expect(service.convertToConsultant('cand1', body, 'actor1')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('throws 409 when the candidate is already a consultant', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue({ id: 'cons-existing' });
    await expect(service.convertToConsultant('cand1', body, 'actor1')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'USER_ALREADY_CONSULTANT' },
    });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('happy path: provisions with a generated company email, runs the repo tx, then activates', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue(null);
    mockProvision.mockResolvedValue({ id: 'kc-123' });
    mockActivate.mockResolvedValue(undefined);
    mockRepo.createConsultantFromCandidate.mockResolvedValue({
      candidate: candidate({ status: 'HIRED' }),
      consultant: { id: 'cons1' } as never,
    });

    const result = await service.convertToConsultant('cand1', body, 'actor1');

    // Login identity is the generated company email, NOT the personal one.
    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada.lovelace@esn.local', realmRole: 'CONSULTANT' }),
    );
    expect(mockRepo.createConsultantFromCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada.lovelace@esn.local',
        keycloakId: 'kc-123',
        candidateId: 'cand1',
        actorId: 'actor1',
      }),
    );
    expect(mockActivate).toHaveBeenCalledWith('kc-123');
    expect(result.consultant).toMatchObject({ id: 'cons1' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('suffixes the company email when the base is taken in the DB', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue(null);
    // Base email collides in the DB; the suffixed one is free.
    mockRepo.findUserByEmail.mockImplementation(async (email: string) =>
      email === 'ada.lovelace@esn.local' ? ({ id: 'user1' } as never) : null,
    );
    mockProvision.mockResolvedValue({ id: 'kc-123' });
    mockActivate.mockResolvedValue(undefined);
    mockRepo.createConsultantFromCandidate.mockResolvedValue({
      candidate: candidate({ status: 'HIRED' }),
      consultant: { id: 'cons1' } as never,
    });

    await service.convertToConsultant('cand1', body, 'actor1');

    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada.lovelace2@esn.local' }),
    );
  });

  it('suffixes the company email when the base is taken in Keycloak', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue(null);
    // Base free in DB but taken in Keycloak; the suffixed one is free in both.
    mockCheckKc.mockImplementation(async (email: string) => email === 'ada.lovelace@esn.local');
    mockProvision.mockResolvedValue({ id: 'kc-123' });
    mockActivate.mockResolvedValue(undefined);
    mockRepo.createConsultantFromCandidate.mockResolvedValue({
      candidate: candidate({ status: 'HIRED' }),
      consultant: { id: 'cons1' } as never,
    });

    await service.convertToConsultant('cand1', body, 'actor1');

    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada.lovelace2@esn.local' }),
    );
  });

  it('still returns success when activation fails after the DB commits', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue(null);
    mockRepo.findUserByEmail.mockResolvedValue(null);
    mockProvision.mockResolvedValue({ id: 'kc-123' });
    mockRepo.createConsultantFromCandidate.mockResolvedValue({
      candidate: candidate({ status: 'HIRED' }),
      consultant: { id: 'cons1' } as never,
    });
    mockActivate.mockRejectedValue(new AppError(500, 'KC', 'enable boom'));

    const result = await service.convertToConsultant('cand1', body, 'actor1');
    expect(result.consultant).toMatchObject({ id: 'cons1' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('compensation: deletes the Keycloak user when the DB transaction fails', async () => {
    mockRepo.findCandidateById.mockResolvedValue(candidate({ status: 'VALIDATED' }));
    mockRepo.findConsultantByCandidateId.mockResolvedValue(null);
    mockRepo.findUserByEmail.mockResolvedValue(null);
    mockProvision.mockResolvedValue({ id: 'kc-123' });
    const dbError = new AppError(500, 'DB', 'db boom');
    mockRepo.createConsultantFromCandidate.mockRejectedValue(dbError);
    mockDelete.mockResolvedValue(undefined);

    await expect(service.convertToConsultant('cand1', body, 'actor1')).rejects.toBe(dbError);
    expect(mockDelete).toHaveBeenCalledWith('kc-123');
    expect(mockActivate).not.toHaveBeenCalled();
  });
});
