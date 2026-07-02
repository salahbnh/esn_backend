import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ContractValidation, Role, ValidationStep } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';

// Mock the repository (so no $transaction / Prisma is touched), the logger, and
// the storage/pdf libs (so importing the service doesn't pull in env-validating
// config or hit MinIO).
vi.mock('./contracts.repository.js');
vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage.js', () => ({
  putObject: vi.fn(async () => undefined),
  buildStorageKey: vi.fn((entityType: string, entityId: string, filename: string) =>
    `${entityType.toLowerCase()}/${entityId}/key-${filename}`,
  ),
}));
vi.mock('../../lib/pdf.js', () => ({
  renderContractPdf: vi.fn(async () => Buffer.from('%PDF-mock')),
}));

import * as repo from './contracts.repository.js';
import * as service from './contracts.service.js';
import { putObject } from '../../lib/storage.js';
import { renderContractPdf } from '../../lib/pdf.js';

const mockRepo = vi.mocked(repo);
const mockPutObject = vi.mocked(putObject);
const mockRenderPdf = vi.mocked(renderContractPdf);

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

  it('merges RH manual fields and records unfilled placeholders', async () => {
    mockRepo.findConsultantForPrefill.mockResolvedValue({
      id: 'con1',
      position: 'Engineer',
      tjm: { toString: () => '500.00' },
      user: { firstName: 'Ada', lastName: 'Lovelace' },
    } as unknown as ConsultantPrefill);
    mockRepo.findTemplate.mockResolvedValue({
      id: 'tmpl1',
      body: '{{firstName}} earns {{salary}} at {{office}}',
    } as unknown as TemplateRow);
    mockRepo.createContract.mockResolvedValue(contract() as unknown as ContractDetail);

    await service.createContract(
      { consultantId: 'con1', templateId: 'tmpl1', type: 'CDI', fields: { salary: '60000' } },
      'actor1',
    );

    const arg = mockRepo.createContract.mock.calls[0]![0] as unknown as {
      prefilledData: { renderedBody: string; unfilled: string[]; fields: Record<string, string> };
    };
    expect(arg.prefilledData.renderedBody).toBe('Ada earns 60000 at {{office}}');
    expect(arg.prefilledData.unfilled).toEqual(['office']);
    expect(arg.prefilledData.fields.salary).toBe('60000');
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
// Two-party signing — consultant-sign / reject / countersign
// ---------------------------------------------------------------------------

const PENDING = {
  status: 'PENDING_SIGNATURE' as const,
  generatedPdfId: 'doc1',
  prefilledData: { renderedBody: 'Le corps du contrat.', unfilled: [] },
};

describe('consultantSignContract', () => {
  beforeEach(() => {
    mockRepo.findActorName.mockResolvedValue('Inès Chevalier');
    mockRepo.consultantSignContract.mockResolvedValue(contract({ status: 'PENDING_SIGNATURE' }));
  });

  it('renders a one-signature PDF and delegates to the repo', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ ...PENDING, consultantSignedAt: null }));
    await service.consultantSignContract('ctr1', 'user-con');
    expect(mockRenderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        signatures: [expect.objectContaining({ label: 'Consultant', name: 'Inès Chevalier' })],
      }),
    );
    expect(mockPutObject).toHaveBeenCalled();
    expect(mockRepo.consultantSignContract).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'ctr1', actorId: 'user-con', signatoryName: 'Inès Chevalier' }),
    );
  });

  it('409 when not PENDING_SIGNATURE', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    await expect(service.consultantSignContract('ctr1', 'user-con')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'NOT_PENDING_SIGNATURE' },
    });
    expect(mockRepo.consultantSignContract).not.toHaveBeenCalled();
  });

  it('409 when already signed by the consultant', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({ ...PENDING, consultantSignedAt: new Date() }),
    );
    await expect(service.consultantSignContract('ctr1', 'user-con')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'ALREADY_SIGNED_BY_CONSULTANT' },
    });
  });

  it('400 when the PDF has not been generated', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({ status: 'PENDING_SIGNATURE', generatedPdfId: null, consultantSignedAt: null }),
    );
    await expect(service.consultantSignContract('ctr1', 'user-con')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'CONTRACT_NO_PDF' },
    });
  });
});

describe('rejectContract', () => {
  beforeEach(() => {
    mockRepo.rejectContractByConsultant.mockResolvedValue(contract({ status: 'DRAFT' }));
  });

  it('delegates a reject when PENDING_SIGNATURE and unsigned', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ ...PENDING, consultantSignedAt: null }));
    const res = await service.rejectContract('ctr1', 'TJM trop bas', 'user-con');
    expect(res.status).toBe('DRAFT');
    expect(mockRepo.rejectContractByConsultant).toHaveBeenCalledWith('ctr1', 'TJM trop bas', 'user-con');
  });

  it('409 when the consultant has already signed', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({ ...PENDING, consultantSignedAt: new Date() }),
    );
    await expect(service.rejectContract('ctr1', 'x', 'user-con')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'ALREADY_SIGNED_BY_CONSULTANT' },
    });
  });
});

describe('countersignContract', () => {
  beforeEach(() => {
    mockRepo.findActorName.mockResolvedValue('RH User');
    mockRepo.countersignContract.mockResolvedValue(contract({ status: 'SIGNED' }));
  });

  it('renders a two-signature PDF and moves to SIGNED', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({
        ...PENDING,
        consultantSignedAt: new Date('2026-07-02'),
        consultantSignatoryName: 'Inès Chevalier',
        companySignedAt: null,
      }),
    );
    const res = await service.countersignContract('ctr1', 'user-rh');
    expect(res.status).toBe('SIGNED');
    expect(mockRenderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        signatures: expect.arrayContaining([
          expect.objectContaining({ label: 'Consultant' }),
          expect.objectContaining({ label: 'ESN — Signataire', name: 'RH User' }),
        ]),
      }),
    );
    expect(mockRepo.countersignContract).toHaveBeenCalled();
  });

  it('409 when the consultant has not signed yet', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({ ...PENDING, consultantSignedAt: null, companySignedAt: null }),
    );
    await expect(service.countersignContract('ctr1', 'user-rh')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'CONSULTANT_NOT_YET_SIGNED' },
    });
    expect(mockRepo.countersignContract).not.toHaveBeenCalled();
  });

  it('409 when not PENDING_SIGNATURE', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'SIGNED' }));
    await expect(service.countersignContract('ctr1', 'user-rh')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'NOT_PENDING_SIGNATURE' },
    });
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

  it('updates a DRAFT contract, re-renders prefill, and audits (happy path)', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    mockRepo.findConsultantForPrefill.mockResolvedValue({
      id: 'con1',
      position: 'Engineer',
      tjm: { toString: () => '500.00' },
      user: { firstName: 'Ada', lastName: 'Lovelace' },
    } as unknown as ConsultantPrefill);
    mockRepo.updateContract.mockResolvedValue(
      contract({ status: 'DRAFT', type: 'CDD' }) as unknown as ContractDetail,
    );

    const res = await service.updateContract('ctr1', { type: 'CDD' }, 'actor1');

    expect(res.type).toBe('CDD');
    // The update payload carries the new type AND a re-rendered prefill snapshot.
    const arg = mockRepo.updateContract.mock.calls[0]!;
    expect(arg[0]).toBe('ctr1');
    expect(arg[1]).toMatchObject({ type: 'CDD' });
    expect(arg[1]).toHaveProperty('prefilledData');
    expect(mockRepo.writeAuditLog).toHaveBeenCalled();
  });

  it('re-renders manual fields with no template (renderedBody empty, no unfilled)', async () => {
    mockRepo.findContractById.mockResolvedValue(contract({ status: 'DRAFT' }));
    mockRepo.findConsultantForPrefill.mockResolvedValue({
      id: 'con1',
      position: 'Engineer',
      tjm: { toString: () => '500.00' },
      user: { firstName: 'Ada', lastName: 'Lovelace' },
    } as unknown as ConsultantPrefill);
    mockRepo.updateContract.mockResolvedValue(contract({ status: 'DRAFT' }) as unknown as ContractDetail);

    await service.updateContract('ctr1', { fields: { salary: '60000' } }, 'actor1');

    const arg = mockRepo.updateContract.mock.calls[0]![1] as unknown as {
      prefilledData: { fields: Record<string, string>; unfilled: string[] };
    };
    expect(arg.prefilledData.fields.salary).toBe('60000');
    expect(arg.prefilledData.unfilled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// In-app PDF generation
// ---------------------------------------------------------------------------

describe('generateContractPdf', () => {
  it('happy path: renders, uploads, stores Document, returns meta', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({
        status: 'PENDING_SIGNATURE',
        prefilledData: { renderedBody: 'Hello Ada', unfilled: [] },
      }),
    );
    mockRepo.storeGeneratedPdf.mockResolvedValue({
      id: 'doc1',
      type: 'CONTRACT',
      entityType: 'CONTRACT',
      entityId: 'ctr1',
      filename: 'contract-ctr1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9,
      createdAt: new Date(),
    });

    const res = await service.generateContractPdf('ctr1', 'actor1');

    expect(mockRenderPdf).toHaveBeenCalledWith({
      title: 'Contrat de travail',
      body: 'Hello Ada',
    });
    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(mockPutObject.mock.calls[0]![0]).toMatchObject({ contentType: 'application/pdf' });
    expect(mockRepo.storeGeneratedPdf).toHaveBeenCalledTimes(1);
    expect(res.document.id).toBe('doc1');
    // storageKey is never surfaced to the caller.
    expect(res.document).not.toHaveProperty('storageKey');
  });

  it('throws 400 INCOMPLETE_CONTRACT when unfilled is non-empty', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({
        status: 'PENDING_SIGNATURE',
        prefilledData: { renderedBody: 'Hi {{office}}', unfilled: ['office'] },
      }),
    );

    await expect(service.generateContractPdf('ctr1', 'actor1')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'INCOMPLETE_CONTRACT', unfilled: ['office'] },
    });
    expect(mockRenderPdf).not.toHaveBeenCalled();
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockRepo.storeGeneratedPdf).not.toHaveBeenCalled();
  });

  it('throws 400 CONTRACT_NOT_READY when status is DRAFT', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({ status: 'DRAFT', prefilledData: { renderedBody: 'x', unfilled: [] } }),
    );

    await expect(service.generateContractPdf('ctr1', 'actor1')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'CONTRACT_NOT_READY' },
    });
    expect(mockRenderPdf).not.toHaveBeenCalled();
    expect(mockRepo.storeGeneratedPdf).not.toHaveBeenCalled();
  });

  it('throws 400 CONTRACT_NO_BODY when the rendered body is empty', async () => {
    mockRepo.findContractById.mockResolvedValue(
      contract({
        status: 'PENDING_SIGNATURE',
        prefilledData: { renderedBody: '   ', unfilled: [] },
      }),
    );

    await expect(service.generateContractPdf('ctr1', 'actor1')).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'CONTRACT_NO_BODY' },
    });
    expect(mockRenderPdf).not.toHaveBeenCalled();
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockRepo.storeGeneratedPdf).not.toHaveBeenCalled();
  });

  it('throws 404 when the contract does not exist', async () => {
    mockRepo.findContractById.mockResolvedValue(null);
    await expect(service.generateContractPdf('nope', 'actor1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
