import type { Contract, Role } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './contracts.repository.js';
import type { Pagination } from './contracts.repository.js';
import type { Prisma } from '@prisma/client';
import { buildPrefillData } from './contracts.prefill.js';
import { STEP_ROLE_MAP, VALIDATION_STEPS } from './contracts.constants.js';
import type {
  CreateAmendmentBody,
  CreateContractBody,
  ListContractsQuery,
  UpdateContractBody,
} from './contracts.schema.js';

/**
 * Contracts business logic: creation with auto-prefill, the validation workflow
 * (RH → MANAGER → DIRECTION step→role gate), signing, archival, amendments.
 * Throws AppError on domain violations. NEVER imports the Prisma client — every
 * multi-write transaction lives in the repository.
 */

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

type ContractListItem = Awaited<ReturnType<typeof repo.listContracts>>['items'][number];
type ContractDetail = NonNullable<Awaited<ReturnType<typeof repo.findContractDetailById>>>;
type AmendmentListItem = Awaited<ReturnType<typeof repo.listAmendments>>['items'][number];

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data: items, total, page, pageSize };
}

async function loadContractOr404(id: string): Promise<Contract> {
  const contract = await repo.findContractById(id);
  if (!contract) {
    throw AppError.notFound('Contract not found');
  }
  return contract;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listContracts(
  query: ListContractsQuery,
): Promise<PaginatedResult<ContractListItem>> {
  // Filtering by status=ARCHIVED must include archived rows, otherwise the
  // archivedAt-is-null guard would silently return zero results.
  const includeArchived = query.includeArchived || query.status === 'ARCHIVED';
  const { items, total } = await repo.listContracts(
    {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.consultantId !== undefined ? { consultantId: query.consultantId } : {}),
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
      includeArchived,
    },
    { page: query.page, pageSize: query.pageSize },
  );
  return paginated(items, total, query.page, query.pageSize);
}

export async function getContract(id: string): Promise<ContractDetail> {
  const contract = await repo.findContractDetailById(id);
  if (!contract) {
    throw AppError.notFound('Contract not found');
  }
  return contract;
}

/**
 * Ownership resolver for `GET /api/contracts/:id` when the caller is a
 * CONSULTANT: returns the owning consultant's userId, or null. Resolved from the
 * DB (never trusting the request).
 */
export function resolveContractOwnerUserId(id: string): Promise<string | null> {
  return repo.findContractConsultantUserId(id);
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createContract(body: CreateContractBody, actorId: string) {
  const consultant = await repo.findConsultantForPrefill(body.consultantId);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }

  let template: { body: string } | null = null;
  if (body.templateId !== undefined) {
    const loaded = await repo.findTemplate(body.templateId);
    if (!loaded) {
      throw AppError.notFound('Contract template not found');
    }
    template = { body: loaded.body };
  }

  const prefill = buildPrefillData({
    template,
    consultant: {
      user: { firstName: consultant.user.firstName, lastName: consultant.user.lastName },
      position: consultant.position,
      tjm: consultant.tjm !== null ? consultant.tjm.toString() : null,
    },
    overrides: {
      ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
      type: body.type,
    },
  });

  // TODO(documents): render the prefilled body as a PDF, upload to MinIO, create
  // a Document row, and set generatedPdfId. For now generatedPdfId stays null.
  const contract = await repo.createContract({
    consultantId: body.consultantId,
    ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
    type: body.type,
    ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    prefilledData: prefill as unknown as Prisma.InputJsonValue,
  });

  await repo.writeAuditLog({
    entityType: 'CONTRACT',
    entityId: contract.id,
    action: 'CREATE',
    actorId,
    payload: { consultantId: body.consultantId, type: body.type },
  });
  return contract;
}

export async function updateContract(
  id: string,
  body: UpdateContractBody,
  actorId: string,
) {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'DRAFT') {
    throw AppError.conflict('Only DRAFT contracts can be updated', {
      code: 'CONTRACT_NOT_DRAFT',
      status: contract.status,
    });
  }

  const updated = await repo.updateContract(id, {
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
  });

  await repo.writeAuditLog({
    entityType: 'CONTRACT',
    entityId: id,
    action: 'UPDATE',
    actorId,
    payload: { fields: Object.keys(body) },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Validation workflow
// ---------------------------------------------------------------------------

export async function submitForValidation(id: string, actorId: string): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'DRAFT') {
    throw AppError.conflict('Only DRAFT contracts can be submitted', {
      code: 'CONTRACT_NOT_DRAFT',
      status: contract.status,
    });
  }
  // The repository runs the race-safe DRAFT → INTERNAL_VALIDATION transition +
  // creates the 3 PENDING validation rows + audit, all in one $transaction.
  return repo.submitForValidation(id, actorId);
}

/**
 * Approve/reject the CURRENT pending validation step. The step→role gate is the
 * security core: the requester's role must equal the role required by the
 * current pending step (RH → MANAGER → DIRECTION). The route already gated the
 * role set; this finishes authorization based on DB state.
 */
export async function processValidationStep(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comment: string | undefined,
  actorRole: Role,
  actorId: string,
): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'INTERNAL_VALIDATION') {
    throw AppError.conflict('Contract is not under internal validation', {
      code: 'NOT_IN_VALIDATION',
      status: contract.status,
    });
  }

  const validations = await repo.findValidations(id);
  if (validations.length === 0) {
    throw AppError.notFound('No validation steps found for this contract');
  }

  // The current pending step is the first PENDING row in RH → MANAGER → DIRECTION
  // order (a rejection of an earlier step would have cleared the rows already).
  const pendingStep = VALIDATION_STEPS.find((step) => {
    const row = validations.find((v) => v.step === step);
    return row?.state === 'PENDING';
  });
  if (!pendingStep) {
    throw AppError.conflict('No pending validation step', { code: 'NO_PENDING_STEP' });
  }

  if (actorRole !== STEP_ROLE_MAP[pendingStep]) {
    throw AppError.forbidden('Not the approver for the current validation step');
  }

  // TODO(notifications): notify the next approver (or the creator on rejection).
  return repo.processValidationStep(id, pendingStep, decision, actorId, comment);
}

// ---------------------------------------------------------------------------
// Sign + archive
// ---------------------------------------------------------------------------

export async function signContract(
  id: string,
  signedPdfDocumentId: string,
  actorId: string,
): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'PENDING_SIGNATURE') {
    throw AppError.conflict('Contract is not pending signature', {
      code: 'NOT_PENDING_SIGNATURE',
      status: contract.status,
    });
  }
  // The repository validates the Document belongs to this contract (IDOR guard),
  // sets signedPdfId + status SIGNED, and audits — all in one $transaction.
  return repo.attachSignedPdf(id, signedPdfDocumentId, actorId);
}

export async function archiveContract(id: string, actorId: string): Promise<Contract> {
  const contract = await loadContractOr404(id);

  // Idempotent: if already archived, return it without a second write or audit.
  if (contract.status === 'ARCHIVED') {
    return contract;
  }

  const updated = await repo.archiveContract(id);
  await repo.writeAuditLog({
    entityType: 'CONTRACT',
    entityId: id,
    action: 'ARCHIVE',
    actorId,
    payload: { from: contract.status, to: 'ARCHIVED' },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

export async function createAmendment(
  contractId: string,
  body: CreateAmendmentBody,
  actorId: string,
) {
  const contract = await loadContractOr404(contractId);
  if (contract.status !== 'SIGNED') {
    throw AppError.badRequest('Amendments are only allowed on signed contracts', {
      code: 'CONTRACT_NOT_SIGNED',
    });
  }

  // TODO(documents): amendment PDFs are generated by the Documents module.
  const amendment = await repo.createAmendment({
    contractId,
    reason: body.reason,
    changes: body.changes,
    effectiveDate: new Date(body.effectiveDate),
    createdById: actorId,
  });

  await repo.writeAuditLog({
    entityType: 'CONTRACT',
    entityId: contractId,
    action: 'AMENDMENT_CREATE',
    actorId,
    payload: { amendment: amendment.id, reason: body.reason },
  });
  return amendment;
}

export async function listAmendments(
  contractId: string,
  pagination: Pagination,
): Promise<PaginatedResult<AmendmentListItem>> {
  if (!(await repo.contractExists(contractId))) {
    throw AppError.notFound('Contract not found');
  }
  const { items, total } = await repo.listAmendments(contractId, pagination);
  return paginated(items, total, pagination.page, pagination.pageSize);
}
