import type {
  Contract,
  ContractAmendment,
  ContractStatus,
  ContractValidation,
  DocumentType,
  EntityType,
  Prisma,
  ValidationStep,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/app-error.js';
import { VALIDATION_STEPS } from './contracts.constants.js';

/**
 * Contracts data-access layer. The ONLY contracts-module file that imports the
 * Prisma client. Multi-write operations (submit, validate, sign) run inside a
 * `$transaction` HERE so the service never touches the Prisma client directly —
 * matching the recruitment `createConsultantFromCandidate` pattern.
 */

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface ContractFilter {
  status?: ContractStatus;
  consultantId?: string;
  type?: string;
  search?: string;
  includeArchived: boolean;
}

export interface CreateContractData {
  consultantId: string;
  templateId?: string;
  type: string;
  startDate?: Date;
  endDate?: Date;
  prefilledData: Prisma.InputJsonValue;
}

export interface UpdateContractData {
  type?: string;
  startDate?: Date;
  endDate?: Date;
  prefilledData?: Prisma.InputJsonValue;
}

export interface CreateAmendmentData {
  contractId: string;
  reason: string;
  changes: Record<string, unknown>;
  effectiveDate: Date;
  createdById: string;
}

export interface AuditLogData {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Prisma.InputJsonValue;
}

const CONSULTANT_DETAIL_INCLUDE = {
  consultant: {
    select: {
      id: true,
      position: true,
      tjm: true,
      status: true,
      userId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

function paginate({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findContractById(id: string): Promise<Contract | null> {
  return prisma.contract.findUnique({ where: { id } });
}

export async function contractExists(id: string): Promise<boolean> {
  const row = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

export function findContractDetailById(id: string) {
  return prisma.contract.findUnique({
    where: { id },
    include: {
      ...CONSULTANT_DETAIL_INCLUDE,
      template: true,
      validations: { orderBy: { createdAt: 'asc' } },
      amendments: { orderBy: { createdAt: 'desc' } },
    },
  });
}

/** For the CONSULTANT ownership resolver: the owning consultant's userId. */
export async function findContractConsultantUserId(id: string): Promise<string | null> {
  const row = await prisma.contract.findUnique({
    where: { id },
    select: { consultant: { select: { userId: true } } },
  });
  return row?.consultant.userId ?? null;
}

/** Loads a template body for prefill/validation. */
export function findTemplate(templateId: string) {
  return prisma.contractTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, body: true },
  });
}

/** Consultant + user snapshot used to build the prefill at creation time. */
export function findConsultantForPrefill(consultantId: string) {
  return prisma.consultant.findUnique({
    where: { id: consultantId },
    select: {
      id: true,
      position: true,
      tjm: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
}

export function findValidations(contractId: string): Promise<ContractValidation[]> {
  return prisma.contractValidation.findMany({ where: { contractId } });
}

/** Resolve a user's display name (for the signature stamp). */
export async function findActorName(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  return u ? `${u.firstName} ${u.lastName}` : null;
}

/** List the contracts owned by the consultant behind this userId (self-service). */
export async function listContractsForConsultant(userId: string, pagination: Pagination) {
  const consultant = await prisma.consultant.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!consultant) {
    return { items: [], total: 0 };
  }
  const where: Prisma.ContractWhereInput = { consultantId: consultant.id };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: CONSULTANT_DETAIL_INCLUDE,
    }),
    prisma.contract.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listContracts(filter: ContractFilter, pagination: Pagination) {
  const where: Prisma.ContractWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  if (!filter.includeArchived) {
    where.archivedAt = null;
  }
  if (filter.consultantId) {
    where.consultantId = filter.consultantId;
  }
  if (filter.type) {
    where.type = filter.type;
  }
  if (filter.search) {
    where.consultant = {
      user: {
        OR: [
          { firstName: { contains: filter.search, mode: 'insensitive' } },
          { lastName: { contains: filter.search, mode: 'insensitive' } },
        ],
      },
    };
  }

  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: CONSULTANT_DETAIL_INCLUDE,
    }),
    prisma.contract.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Simple mutations
// ---------------------------------------------------------------------------

export function createContract(data: CreateContractData) {
  return prisma.contract.create({
    data: {
      consultantId: data.consultantId,
      ...(data.templateId !== undefined ? { templateId: data.templateId } : {}),
      type: data.type,
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      prefilledData: data.prefilledData,
    },
    include: CONSULTANT_DETAIL_INCLUDE,
  });
}

export function updateContract(id: string, data: UpdateContractData) {
  return prisma.contract.update({
    where: { id },
    data: {
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      ...(data.prefilledData !== undefined ? { prefilledData: data.prefilledData } : {}),
    },
    include: CONSULTANT_DETAIL_INCLUDE,
  });
}

export function archiveContract(id: string): Promise<Contract> {
  return prisma.contract.update({
    where: { id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Submit for validation — atomic DRAFT → INTERNAL_VALIDATION + 3 PENDING rows
// ---------------------------------------------------------------------------

/**
 * Race-safe submit: `updateMany` only flips a contract still in DRAFT and the
 * `count === 1` guard aborts a concurrent double-submit. The 3 ContractValidation
 * rows (RH/MANAGER/DIRECTION, PENDING) are created in the SAME transaction.
 */
export function submitForValidation(contractId: string, actorId: string): Promise<Contract> {
  return prisma.$transaction(async (tx) => {
    const transition = await tx.contract.updateMany({
      where: { id: contractId, status: 'DRAFT' },
      // Clear any prior consultant rejection reason when re-submitting.
      data: { status: 'INTERNAL_VALIDATION', rejectionReason: null },
    });
    if (transition.count === 0) {
      throw AppError.conflict('Contract is not in DRAFT', { code: 'SUBMIT_RACE' });
    }

    await tx.contractValidation.createMany({
      data: VALIDATION_STEPS.map((step) => ({ contractId, step, state: 'PENDING' as const })),
    });

    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: contractId,
        action: 'STATUS_CHANGE',
        actorId,
        payload: { from: 'DRAFT', to: 'INTERNAL_VALIDATION', via: 'submit' },
      },
    });

    return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  });
}

// ---------------------------------------------------------------------------
// Process a validation step — atomic, ordering-enforced
// ---------------------------------------------------------------------------

/**
 * Atomically process a single validation step. Re-reads the step row inside the
 * transaction and asserts it is still PENDING and all PRIOR steps are APPROVED
 * (race-safe ordering). On APPROVED of the last step (DIRECTION) the contract
 * moves to PENDING_SIGNATURE; any REJECTED reverts the contract to DRAFT and
 * deletes all validation rows so a clean re-submit creates fresh ones.
 */
export function processValidationStep(
  contractId: string,
  step: ValidationStep,
  decision: 'APPROVED' | 'REJECTED',
  validatorId: string,
  comment: string | undefined,
): Promise<Contract> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.contractValidation.findMany({ where: { contractId } });
    const current = rows.find((r) => r.step === step);
    if (!current) {
      throw AppError.notFound('Validation step not found');
    }
    if (current.state !== 'PENDING') {
      throw AppError.conflict('Validation step is not pending', {
        code: 'STEP_NOT_PENDING',
        step,
      });
    }

    // Ordering: every prior step must already be APPROVED.
    const stepIndex = VALIDATION_STEPS.indexOf(step);
    for (let i = 0; i < stepIndex; i += 1) {
      const priorStep = VALIDATION_STEPS[i]!;
      const prior = rows.find((r) => r.step === priorStep);
      if (!prior || prior.state !== 'APPROVED') {
        throw AppError.conflict('Prior validation step not yet approved', {
          code: 'STEP_OUT_OF_ORDER',
          pending: priorStep,
        });
      }
    }

    // The in-tx re-read of the step rows above relies on Postgres READ COMMITTED
    // isolation for safety against concurrent validation requests on the same step.

    // REJECTED: skip the wasted per-row update to REJECTED — go straight to
    // clearing all validation rows, reverting the contract to DRAFT, and auditing.
    if (decision === 'REJECTED') {
      await tx.contractValidation.deleteMany({ where: { contractId } });
      await tx.contract.update({ where: { id: contractId }, data: { status: 'DRAFT' } });
      await tx.auditLog.create({
        data: {
          entityType: 'CONTRACT',
          entityId: contractId,
          action: 'STATUS_CHANGE',
          actorId: validatorId,
          payload: { step, decision, to: 'DRAFT', comment: comment ?? null },
        },
      });
      return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    }

    // APPROVED: record the decision on the step row.
    await tx.contractValidation.update({
      where: { contractId_step: { contractId, step } },
      data: {
        state: decision,
        validatorId,
        decidedAt: new Date(),
        ...(comment !== undefined ? { comment } : {}),
      },
    });

    // If this is the last step, the internal validation is complete.
    const isLastStep = stepIndex === VALIDATION_STEPS.length - 1;
    if (isLastStep) {
      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'PENDING_SIGNATURE' },
      });
    }

    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: contractId,
        action: isLastStep ? 'STATUS_CHANGE' : 'VALIDATION',
        actorId: validatorId,
        payload: {
          step,
          decision,
          ...(isLastStep ? { to: 'PENDING_SIGNATURE' } : {}),
          comment: comment ?? null,
        },
      },
    });

    return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  });
}

// ---------------------------------------------------------------------------
// Store a generated PDF — Document row + generatedPdfId pointer + audit, atomic
// ---------------------------------------------------------------------------

export interface StoreGeneratedPdfInput {
  contractId: string;
  storageKey: string;
  filename: string;
  sizeBytes: number;
  actorId: string;
}

export interface GeneratedPdfMeta {
  id: string;
  type: DocumentType;
  entityType: EntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

/**
 * Persist a server-generated contract PDF: create the Document row
 * (type/entityType=CONTRACT, entityId=contractId), repoint
 * `contract.generatedPdfId` at it, and audit — all in one `$transaction`. The
 * object bytes are uploaded by the SERVICE BEFORE this call so no storage I/O
 * runs inside the transaction. `storageKey` is never returned.
 */
export function storeGeneratedPdf(input: StoreGeneratedPdfInput): Promise<GeneratedPdfMeta> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        type: 'CONTRACT',
        entityType: 'CONTRACT',
        entityId: input.contractId,
        filename: input.filename,
        mimeType: 'application/pdf',
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        uploadedById: input.actorId,
      },
      select: {
        id: true,
        type: true,
        entityType: true,
        entityId: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });

    // TODO: soft-delete superseded generated PDF (old doc + its MinIO object are
    // left orphaned for now when a contract is re-generated).
    await tx.contract.update({
      where: { id: input.contractId },
      data: { generatedPdfId: doc.id },
    });

    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: input.contractId,
        action: 'GENERATE_PDF',
        actorId: input.actorId,
        payload: { documentId: doc.id, filename: input.filename },
      },
    });

    return doc;
  });
}

// ---------------------------------------------------------------------------
// Two-party signing — consultant-sign / reject / countersign (each atomic)
// ---------------------------------------------------------------------------

export interface SignPdfInput {
  contractId: string;
  storageKey: string;
  filename: string;
  sizeBytes: number;
  actorId: string;
  signedAt: Date;
  signatoryName: string;
}

/** Create the freshly-stamped PDF Document and repoint generatedPdfId (in-tx). */
async function replaceGeneratedPdf(
  tx: Prisma.TransactionClient,
  input: SignPdfInput,
): Promise<string> {
  const doc = await tx.document.create({
    data: {
      type: 'CONTRACT',
      entityType: 'CONTRACT',
      entityId: input.contractId,
      filename: input.filename,
      mimeType: 'application/pdf',
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      uploadedById: input.actorId,
    },
    select: { id: true },
  });
  return doc.id;
}

/**
 * Consultant signs their own contract: create the stamped PDF, then race-safely
 * set consultantSignedAt (+ name) on a contract still PENDING_SIGNATURE and not
 * yet consultant-signed. Stays in PENDING_SIGNATURE (awaits countersignature).
 */
export function consultantSignContract(input: SignPdfInput): Promise<Contract> {
  return prisma.$transaction(async (tx) => {
    const docId = await replaceGeneratedPdf(tx, input);
    const transition = await tx.contract.updateMany({
      where: { id: input.contractId, status: 'PENDING_SIGNATURE', consultantSignedAt: null },
      data: {
        generatedPdfId: docId,
        consultantSignedAt: input.signedAt,
        consultantSignatoryName: input.signatoryName,
      },
    });
    if (transition.count === 0) {
      throw AppError.conflict('Contract is not awaiting the consultant signature', {
        code: 'ALREADY_SIGNED_BY_CONSULTANT',
      });
    }
    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: input.contractId,
        action: 'CONSULTANT_SIGN',
        actorId: input.actorId,
        payload: { documentId: docId, signatoryName: input.signatoryName },
      },
    });
    return tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
  });
}

/**
 * Consultant rejects with a reason: race-safely revert PENDING_SIGNATURE (not yet
 * signed) → DRAFT, store the reason, and delete the validation rows so a clean
 * re-submit recreates them (mirrors the validation-reject path).
 */
export function rejectContractByConsultant(
  contractId: string,
  reason: string,
  actorId: string,
): Promise<Contract> {
  return prisma.$transaction(async (tx) => {
    const transition = await tx.contract.updateMany({
      where: { id: contractId, status: 'PENDING_SIGNATURE', consultantSignedAt: null },
      data: { status: 'DRAFT', rejectionReason: reason },
    });
    if (transition.count === 0) {
      throw AppError.conflict('Contract cannot be rejected in its current state', {
        code: 'ALREADY_SIGNED_BY_CONSULTANT',
      });
    }
    await tx.contractValidation.deleteMany({ where: { contractId } });
    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: contractId,
        action: 'STATUS_CHANGE',
        actorId,
        payload: { from: 'PENDING_SIGNATURE', to: 'DRAFT', via: 'consultant_reject', reason },
      },
    });
    return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  });
}

/**
 * Company countersigns: create the fully-stamped PDF, then race-safely set
 * companySignedAt (+ name) and move to SIGNED — only when the consultant has
 * already signed and no countersignature exists yet.
 */
export function countersignContract(input: SignPdfInput): Promise<Contract> {
  return prisma.$transaction(async (tx) => {
    const docId = await replaceGeneratedPdf(tx, input);
    const transition = await tx.contract.updateMany({
      where: {
        id: input.contractId,
        status: 'PENDING_SIGNATURE',
        consultantSignedAt: { not: null },
        companySignedAt: null,
      },
      data: {
        generatedPdfId: docId,
        companySignedAt: input.signedAt,
        companySignatoryName: input.signatoryName,
        status: 'SIGNED',
      },
    });
    if (transition.count === 0) {
      throw AppError.conflict('Contract is not awaiting countersignature', {
        code: 'NOT_AWAITING_COUNTERSIGN',
      });
    }
    await tx.auditLog.create({
      data: {
        entityType: 'CONTRACT',
        entityId: input.contractId,
        action: 'STATUS_CHANGE',
        actorId: input.actorId,
        payload: {
          from: 'PENDING_SIGNATURE',
          to: 'SIGNED',
          via: 'countersign',
          documentId: docId,
          signatoryName: input.signatoryName,
        },
      },
    });
    return tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
  });
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

export function createAmendment(data: CreateAmendmentData): Promise<ContractAmendment> {
  // TODO(documents): generate the amendment PDF, upload to MinIO, create a
  // Document row, and set generatedPdfId. For now generatedPdfId stays null.
  return prisma.contractAmendment.create({
    data: {
      contractId: data.contractId,
      reason: data.reason,
      changes: data.changes as Prisma.InputJsonValue,
      effectiveDate: data.effectiveDate,
      createdById: data.createdById,
    },
  });
}

export async function listAmendments(contractId: string, pagination: Pagination) {
  const where: Prisma.ContractAmendmentWhereInput = { contractId };
  const { skip, take } = paginate(pagination);
  const [items, total] = await Promise.all([
    prisma.contractAmendment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contractAmendment.count({ where }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Audit (non-transactional, best-effort for standalone mutations)
// ---------------------------------------------------------------------------

export async function writeAuditLog(
  entry: AuditLogData,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({ data: entry });
}
