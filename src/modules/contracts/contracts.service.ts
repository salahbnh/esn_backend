import type { Contract, Role } from '@prisma/client';
import { AppError } from '../../lib/app-error.js';
import * as repo from './contracts.repository.js';
import type { Pagination } from './contracts.repository.js';
import type { Prisma } from '@prisma/client';
import { buildPrefillData } from './contracts.prefill.js';
import type { PrefillResult } from './contracts.prefill.js';
import { renderContractPdf } from '../../lib/pdf.js';
import type { SignatureBlock } from '../../lib/pdf.js';
import { buildStorageKey, putObject } from '../../lib/storage.js';
import { STEP_ROLE_MAP, VALIDATION_STEPS } from './contracts.constants.js';
import type {
  CreateAmendmentBody,
  CreateContractBody,
  ListContractsQuery,
  PaginationQuery,
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

/**
 * Builds the prefill snapshot for a consultant + (optional) template, merging
 * the RH-entered manual `fields`. Loads the consultant (404 if missing) and the
 * template body (404 if a templateId is given but missing).
 */
async function computePrefill(args: {
  consultantId: string;
  templateId?: string;
  type: string;
  startDate?: string;
  endDate?: string;
  fields?: Record<string, string>;
}) {
  const consultant = await repo.findConsultantForPrefill(args.consultantId);
  if (!consultant) {
    throw AppError.notFound('Consultant not found');
  }

  let template: { body: string } | null = null;
  if (args.templateId !== undefined) {
    const loaded = await repo.findTemplate(args.templateId);
    if (!loaded) {
      throw AppError.notFound('Contract template not found');
    }
    template = { body: loaded.body };
  }

  return buildPrefillData({
    template,
    consultant: {
      user: { firstName: consultant.user.firstName, lastName: consultant.user.lastName },
      position: consultant.position,
      tjm: consultant.tjm !== null ? consultant.tjm.toString() : null,
    },
    overrides: {
      ...(args.startDate !== undefined ? { startDate: args.startDate } : {}),
      ...(args.endDate !== undefined ? { endDate: args.endDate } : {}),
      type: args.type,
    },
    ...(args.fields !== undefined ? { fields: args.fields } : {}),
  });
}

export async function createContract(body: CreateContractBody, actorId: string) {
  const prefill = await computePrefill({
    consultantId: body.consultantId,
    ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
    type: body.type,
    ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
    ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
    ...(body.fields !== undefined ? { fields: body.fields } : {}),
  });

  // PDF generation is on-demand via POST /:id/generate-pdf; generatedPdfId stays
  // null until then. The full prefill snapshot (fields + renderedBody + unfilled)
  // is persisted now so generation can later refuse an incomplete contract.
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

  // Re-render the prefill from the effective (merged) field values so the stored
  // snapshot + unfilled list stay in sync after an edit. AUTO values are derived
  // from the consultant; RH `fields` provide the manual ones.
  const effectiveType = body.type ?? contract.type;
  const effectiveStart = body.startDate ?? contract.startDate?.toISOString();
  const effectiveEnd = body.endDate ?? contract.endDate?.toISOString();
  const prefill = await computePrefill({
    consultantId: contract.consultantId,
    ...(contract.templateId !== null ? { templateId: contract.templateId } : {}),
    type: effectiveType,
    ...(effectiveStart !== undefined ? { startDate: effectiveStart } : {}),
    ...(effectiveEnd !== undefined ? { endDate: effectiveEnd } : {}),
    ...(body.fields !== undefined ? { fields: body.fields } : {}),
  });

  const updated = await repo.updateContract(id, {
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
    ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
    prefilledData: prefill as unknown as Prisma.InputJsonValue,
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

/** CONSULTANT self-service: their own contracts (auto-scoped by userId). */
export async function listMyContracts(
  userId: string,
  query: PaginationQuery,
): Promise<PaginatedResult<ContractListItem>> {
  const { items, total } = await repo.listContractsForConsultant(userId, {
    page: query.page,
    pageSize: query.pageSize,
  });
  return paginated(items, total, query.page, query.pageSize);
}

/**
 * Re-render the contract body with signature stamps and upload it to object
 * storage (I/O runs BEFORE the repository $transaction). Returns the pointer the
 * repository needs to create the new Document row + repoint generatedPdfId.
 */
async function uploadStampedPdf(
  contractId: string,
  renderedBody: string,
  signatures: SignatureBlock[],
): Promise<{ storageKey: string; filename: string; sizeBytes: number }> {
  const pdf = await renderContractPdf({ title: 'Contrat de travail', body: renderedBody, signatures });
  const filename = `contract-${contractId}.pdf`;
  const storageKey = buildStorageKey('CONTRACT', contractId, filename);
  await putObject({ key: storageKey, body: pdf, contentType: 'application/pdf' });
  return { storageKey, filename, sizeBytes: pdf.length };
}

/**
 * Consultant signs their own contract (in-app acknowledgment). Requires a
 * generated PDF to stamp; stamps the consultant's name + date and records
 * consultantSignedAt. Stays PENDING_SIGNATURE, awaiting the company countersign.
 */
export async function consultantSignContract(id: string, actorId: string): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'PENDING_SIGNATURE') {
    throw AppError.conflict('Contract is not pending signature', {
      code: 'NOT_PENDING_SIGNATURE',
      status: contract.status,
    });
  }
  if (contract.consultantSignedAt) {
    throw AppError.conflict('You have already signed this contract', {
      code: 'ALREADY_SIGNED_BY_CONSULTANT',
    });
  }
  if (!contract.generatedPdfId) {
    throw AppError.badRequest('The contract PDF has not been generated yet', {
      code: 'CONTRACT_NO_PDF',
    });
  }
  const { renderedBody } = readPrefill(contract.prefilledData);
  if (renderedBody.trim().length === 0) {
    throw AppError.badRequest('Contract has no body to render', { code: 'CONTRACT_NO_BODY' });
  }

  const signatoryName = (await repo.findActorName(actorId)) ?? 'Consultant';
  const signedAt = new Date();
  const uploaded = await uploadStampedPdf(id, renderedBody, [
    { label: 'Consultant', name: signatoryName, date: signedAt },
  ]);
  return repo.consultantSignContract({ contractId: id, ...uploaded, actorId, signedAt, signatoryName });
}

/**
 * Consultant rejects their own contract with a reason → back to DRAFT (only
 * before they have signed). RH edits and re-submits for validation.
 */
export async function rejectContract(
  id: string,
  reason: string,
  actorId: string,
): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'PENDING_SIGNATURE') {
    throw AppError.conflict('Contract is not pending signature', {
      code: 'NOT_PENDING_SIGNATURE',
      status: contract.status,
    });
  }
  if (contract.consultantSignedAt) {
    throw AppError.conflict('You have already signed this contract', {
      code: 'ALREADY_SIGNED_BY_CONSULTANT',
    });
  }
  return repo.rejectContractByConsultant(id, reason, actorId);
}

/**
 * Company (RH/DIRECTION) countersigns after the consultant has signed → SIGNED.
 * Re-renders the PDF with BOTH signature blocks.
 */
export async function countersignContract(id: string, actorId: string): Promise<Contract> {
  const contract = await loadContractOr404(id);
  if (contract.status !== 'PENDING_SIGNATURE') {
    throw AppError.conflict('Contract is not pending signature', {
      code: 'NOT_PENDING_SIGNATURE',
      status: contract.status,
    });
  }
  if (!contract.consultantSignedAt) {
    throw AppError.conflict('The consultant has not signed yet', {
      code: 'CONSULTANT_NOT_YET_SIGNED',
    });
  }
  if (contract.companySignedAt) {
    throw AppError.conflict('This contract has already been countersigned', {
      code: 'ALREADY_COUNTERSIGNED',
    });
  }
  const { renderedBody } = readPrefill(contract.prefilledData);
  if (renderedBody.trim().length === 0) {
    throw AppError.badRequest('Contract has no body to render', { code: 'CONTRACT_NO_BODY' });
  }

  const signatoryName = (await repo.findActorName(actorId)) ?? 'ESN';
  const signedAt = new Date();
  const signatures: SignatureBlock[] = [
    {
      label: 'Consultant',
      name: contract.consultantSignatoryName ?? 'Consultant',
      date: contract.consultantSignedAt,
    },
    { label: 'ESN — Signataire', name: signatoryName, date: signedAt },
  ];
  const uploaded = await uploadStampedPdf(id, renderedBody, signatures);
  return repo.countersignContract({ contractId: id, ...uploaded, actorId, signedAt, signatoryName });
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
// In-app PDF generation
// ---------------------------------------------------------------------------

/** The shape we read back out of the persisted `prefilledData` Json blob. */
type StoredPrefill = Pick<PrefillResult, 'renderedBody' | 'unfilled'>;

function readPrefill(data: unknown): StoredPrefill {
  const obj = (data ?? {}) as Record<string, unknown>;
  const renderedBody = typeof obj['renderedBody'] === 'string' ? obj['renderedBody'] : '';
  const unfilled = Array.isArray(obj['unfilled'])
    ? (obj['unfilled'] as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  return { renderedBody, unfilled };
}

/**
 * Render the contract's prefilled body to a PDF, upload it to object storage,
 * then atomically create the Document row + repoint generatedPdfId + audit.
 * Storage I/O (putObject) runs BEFORE the repository $transaction. Guards:
 *  - status must be INTERNAL_VALIDATION or PENDING_SIGNATURE (after submit).
 *  - prefilledData.unfilled must be empty (no blank placeholders in the PDF).
 */
export async function generateContractPdf(
  contractId: string,
  actorId: string,
): Promise<{ document: repo.GeneratedPdfMeta }> {
  const contract = await loadContractOr404(contractId);

  if (contract.status !== 'INTERNAL_VALIDATION' && contract.status !== 'PENDING_SIGNATURE') {
    throw AppError.badRequest('Contract is not ready for PDF generation', {
      code: 'CONTRACT_NOT_READY',
      status: contract.status,
    });
  }

  const prefill = readPrefill(contract.prefilledData);
  if (prefill.unfilled.length > 0) {
    throw AppError.badRequest('Contract has unfilled placeholders', {
      code: 'INCOMPLETE_CONTRACT',
      unfilled: prefill.unfilled,
    });
  }

  if (prefill.renderedBody.trim().length === 0) {
    throw AppError.badRequest('Contract has no template body to render', {
      code: 'CONTRACT_NO_BODY',
    });
  }

  const pdf = await renderContractPdf({
    title: 'Contrat de travail',
    body: prefill.renderedBody,
  });

  // Storage I/O happens HERE — outside the repository $transaction.
  const filename = `contract-${contractId}.pdf`;
  const storageKey = buildStorageKey('CONTRACT', contractId, filename);
  await putObject({ key: storageKey, body: pdf, contentType: 'application/pdf' });

  const document = await repo.storeGeneratedPdf({
    contractId,
    storageKey,
    filename,
    sizeBytes: pdf.length,
    actorId,
  });

  return { document };
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
