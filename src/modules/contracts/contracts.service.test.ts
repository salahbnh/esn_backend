import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ContractValidation, Role, ValidationStep } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';

// Mock the repository (so no $transaction / Prisma is touched) and the logger
// (so importing the service doesn't pull in env-validating config).
vi.mock('./contracts.repository.js');
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as repo from './contracts.repository.js';
import * as service from './contracts.service.js';

const mockRepo = vi.mocked(repo);

type ConsultantPrefill = NonNullable<Awaited<ReturnType<typeof repo.findConsultantForPrefill>>>;
type TemplateRow = NonNullable<Awaited<ReturnType<typeof repo.findTemplate>>>;
type ContractDetail = NonNullable<Awaited<ReturnType<typeof repo.findContractDetailById>>>;

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'ctr1',
    consultantId: 'con1',
    templateId: null,
    type: 'CDI',
    status: 'DRAFT',
    prefilledData: {},
    generatedPdfId: null,
    signedPdfId: null,
    startDate: null,
    endDate: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Contract;
}

function validation(
  step: ValidationStep,
  state: 'PENDING' | 'APPROVED' | 'REJECTED',
): ContractValidation {
  return {
    id: `v-${step}`,
    contractId: 'ctr1',
    step,
    state,
    validatorId: null,
    decidedAt: null,
    comment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ContractValidation;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.writeAuditLog.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Create — prefill snapshot
// ---------------------------------------------------------------------------

describe('createContract', () => {
  it('builds prefill from the consultant + template and stores it', async () => {
    mockRepo.findConsultantForPrefill.mockResolvedValue({
      id: 'con1',
      position: 'Engineer',
      tjm: { toString: () => '500.00' },
      user: { firstName: 'Ada', lastName: 'Lovelace' },
    } as unknown as ConsultantPrefill);
    mockRepo.findTemplate.mockResolvedValue({
      id: 'tmpl1',
      body: 'Hi {{firstName}} ({{type}})',
    } as unknown as TemplateRow);
    mockRepo.createContract.mockResolvedValue(contract() as unknown as ContractDetail);

    await service.createContract(
      { consultantId: 'con1', templateId: 'tmpl1', type: 'CDI' },
      'actor1',
    );

    expect(mockRepo.createContract).toHaveBeenCalledTimes(1);
    const arg = mockRepo.createContract.mock.calls[0]![0] as unknown as {
      prefilledData: { renderedBody: string };
    };
    expect(arg.prefilledData.renderedBody).toBe('Hi Ada (CDI)');
    expect(mockRepo.writeAuditLog).toHaveBeenCalled();
  });

  it('throws 404 when the consultant does not exist', async () => {
    mockRepo.findConsultantForPrefill.mockResolvedValue(null);
    await expect(
      service.createContract({ consultantId: 'nope', type: 'CDI' }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Submit guards
// ---------------------------------------------------------------------------

describe('submitForValidation', () => {
  it('delegates to the repo when the contract is DRAFT', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    mockRepo.submitForValidation.mockResolvedValue(contract({ status: 'INTERNAL_VALIDATION' }));
    const res = await service.submitForValidation('ctr1', 'actor1');
    expect(res.status).toBe('INTERNAL_VALIDATION');
    expect(mockRepo.submitForValidation).toHaveBeenCalledWith('ctr1', 'actor1');
  });

  it('throws 409 when the contract is not DRAFT (idempotent guard)', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'INTERNAL_VALIDATION' }));
    await expect(service.submitForValidation('ctr1', 'actor1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockRepo.submitForValidation).not.toHaveBeenCalled();
  });

  it('throws 404 when the contract does not exist', async () => {
    mockRepo.findContractById.mockResolvedValue(null);
    await expect(service.submitForValidation('nope', 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// Validation step machine — step→role gate + ordering
// ---------------------------------------------------------------------------

describe('processValidationStep', () => {
  function setup(states: Record<ValidationStep, 'PENDING' | 'APPROVED' | 'REJECTED'>) {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'INTERNAL_VALIDATION' }));
    mockRepo.findValidations.mockResolvedValue([
      validation('RH', states.RH),
      validation('MANAGER', states.MANAGER),
      validation('DIRECTION', states.DIRECTION),
    ]);
    mockRepo.processValidationStep.mockResolvedValue(contract());
  }

  async function act(role: Role, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
    return service.processValidationStep('ctr1', decision, undefined, role, `${role}-id`);
  }

  it('RH can approve the RH step', async () => {
    setup({ RH: 'PENDING', MANAGER: 'PENDING', DIRECTION: 'PENDING' });
    await act('RH');
    expect(mockRepo.processValidationStep).toHaveBeenCalledWith(
      'ctr1',
      'RH',
      'APPROVED',
      'RH-id',
      undefined,
    );
  });

  it('MANAGER gets 403 while the RH step is still pending', async () => {
    setup({ RH: 'PENDING', MANAGER: 'PENDING', DIRECTION: 'PENDING' });
    await expect(act('MANAGER')).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRepo.processValidationStep).not.toHaveBeenCalled();
  });

  it('MANAGER can approve after RH approved', async () => {
    setup({ RH: 'APPROVED', MANAGER: 'PENDING', DIRECTION: 'PENDING' });
    await act('MANAGER');
    expect(mockRepo.processValidationStep).toHaveBeenCalledWith(
      'ctr1',
      'MANAGER',
      'APPROVED',
      'MANAGER-id',
      undefined,
    );
  });

  it('DIRECTION approves last step -> PENDING_SIGNATURE (propagated)', async () => {
    setup({ RH: 'APPROVED', MANAGER: 'APPROVED', DIRECTION: 'PENDING' });
    mockRepo.processValidationStep.mockResolvedValue(contract({ status: 'PENDING_SIGNATURE' }));
    const res = await act('DIRECTION');
    expect(res.status).toBe('PENDING_SIGNATURE');
    expect(mockRepo.processValidationStep).toHaveBeenCalledWith(
      'ctr1',
      'DIRECTION',
      'APPROVED',
      'DIRECTION-id',
      undefined,
    );
  });

  it('RH acting on the MANAGER step is forbidden', async () => {
    setup({ RH: 'APPROVED', MANAGER: 'PENDING', DIRECTION: 'PENDING' });
    await expect(act('RH')).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRepo.processValidationStep).not.toHaveBeenCalled();
  });

  it('rejection is delegated to the repo (which reverts to DRAFT + clears rows)', async () => {
    setup({ RH: 'PENDING', MANAGER: 'PENDING', DIRECTION: 'PENDING' });
    mockRepo.processValidationStep.mockResolvedValue(contract({ status: 'DRAFT' }));
    const res = await act('RH', 'REJECTED');
    expect(res.status).toBe('DRAFT');
    expect(mockRepo.processValidationStep).toHaveBeenCalledWith(
      'ctr1',
      'RH',
      'REJECTED',
      'RH-id',
      undefined,
    );
  });

  it('throws 409 when the contract is not under internal validation', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    await expect(act('RH')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 404 when the contract does not exist', async () => {
    mockRepo.findContractById.mockResolvedValue(null);
    await expect(act('RH')).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// Sign guard
// ---------------------------------------------------------------------------

describe('signContract', () => {
  it('delegates when PENDING_SIGNATURE', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'PENDING_SIGNATURE' }));
    mockRepo.attachSignedPdf.mockResolvedValue(contract({ status: 'SIGNED' }));
    const res = await service.signContract('ctr1', 'doc1', 'actor1');
    expect(res.status).toBe('SIGNED');
    expect(mockRepo.attachSignedPdf).toHaveBeenCalledWith('ctr1', 'doc1', 'actor1');
  });

  it('throws 409 when not PENDING_SIGNATURE', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    await expect(service.signContract('ctr1', 'doc1', 'actor1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockRepo.attachSignedPdf).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Archive (idempotent) + update guard
// ---------------------------------------------------------------------------

describe('archiveContract', () => {
  it('archives a non-archived contract (audited)', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'SIGNED' }));
    mockRepo.archiveContract.mockResolvedValue(contract({ status: 'ARCHIVED' }));
    const res = await service.archiveContract('ctr1', 'actor1');
    expect(res.status).toBe('ARCHIVED');
    expect(mockRepo.writeAuditLog).toHaveBeenCalled();
  });

  it('is idempotent — already ARCHIVED skips the second write/audit', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'ARCHIVED' }));
    await service.archiveContract('ctr1', 'actor1');
    expect(mockRepo.archiveContract).not.toHaveBeenCalled();
    expect(mockRepo.writeAuditLog).not.toHaveBeenCalled();
  });

  it('throws 404 when the contract does not exist', async () => {
    mockRepo.findContractById.mockResolvedValue(null);
    await expect(service.archiveContract('nope', 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('updateContract', () => {
  it('throws 409 when the contract is not DRAFT', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'INTERNAL_VALIDATION' }));
    await expect(
      service.updateContract('ctr1', { type: 'CDD' }, 'actor1'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRepo.updateContract).not.toHaveBeenCalled();
  });

  it('updates a DRAFT contract and audits (happy path)', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    mockRepo.updateContract.mockResolvedValue(
      contract({ status: 'DRAFT', type: 'CDD' }) as unknown as ContractDetail,
    );

    const res = await service.updateContract('ctr1', { type: 'CDD' }, 'actor1');

    expect(res.type).toBe('CDD');
    expect(mockRepo.updateContract).toHaveBeenCalledWith('ctr1', { type: 'CDD' });
    expect(mockRepo.writeAuditLog).toHaveBeenCalled();
  });
});
