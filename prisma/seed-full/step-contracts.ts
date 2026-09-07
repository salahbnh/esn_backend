/**
 * Employment contracts, their validation workflow and their amendments.
 *
 * `prefilledData` is produced by the app's own `buildPrefillData()` rather than
 * hand-written, so the stored snapshot (fields + renderedBody + unfilled) is
 * byte-for-byte what the API would have persisted — which matters because
 * `generateContractPdf` refuses a contract with unfilled placeholders.
 *
 * Validation rows mirror the real RH -> MANAGER -> DIRECTION machine:
 *   DRAFT                 no rows
 *   INTERNAL_VALIDATION   earlier steps APPROVED, the current one PENDING
 *   PENDING_SIGNATURE     all three APPROVED
 *   SIGNED / ARCHIVED     all three APPROVED + signature stamps
 */
import type { ContractStatus, Prisma, PrismaClient, ValidationStep } from '@prisma/client';
import { buildPrefillData } from '../../src/modules/contracts/contracts.prefill.js';
import { sid, n2 } from './ids.js';
import { days, isoDay, months } from './rng.js';
import type { SeededConsultant } from './step-consultants.js';
import { staffOf, type StaffMap } from './step-users.js';
import { TEMPLATES } from './step-reference.js';

type TemplateKey = 'cdi' | 'cdd' | 'regie';

interface ContractRow {
  key: string;
  consultant: string;
  type: string;
  template: TemplateKey;
  status: ContractStatus;
  /** Months from today. */
  start: number;
  end: number | null;
  manager: string;
  fields: Record<string, string>;
  /** PENDING_SIGNATURE only: consultant has signed, company has not. */
  awaitingCountersign?: boolean;
}

const CDI = (salary: number, city: string) => ({
  lieuTravail: city,
  remunerationAnnuelle: String(salary),
  periodeEssai: '3 mois renouvelable une fois',
});
const CDD = (salary: number, motif: string) => ({
  motifRecours: motif,
  remunerationAnnuelle: String(salary),
});
const REGIE = (client: string) => ({ nomClient: client });

const CONTRACTS: readonly ContractRow[] = [
  { key: 'ct01', consultant: 'c01', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -38, end: null, manager: 'mgr1', fields: CDI(72000, 'Tunis — Lac 2') },
  // Left unsigned on purpose: this is the contract the shipped consultant login
  // (consultant@esn.local) can actually sign from /me/contract.
  { key: 'ct02', consultant: 'c01', type: 'Régie', template: 'regie', status: 'PENDING_SIGNATURE', start: 1, end: 13, manager: 'mgr1', fields: REGIE('Carthage Assurances') },
  { key: 'ct03', consultant: 'c02', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -26, end: null, manager: 'mgr2', fields: CDI(54000, 'Tunis — Centre Urbain Nord') },
  { key: 'ct04', consultant: 'c03', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -44, end: null, manager: 'mgr1', fields: CDI(78000, 'Ariana — Ghazela') },
  { key: 'ct05', consultant: 'c04', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -19, end: null, manager: 'mgr2', fields: CDI(58000, 'Tunis — Lac 2') },
  { key: 'ct06', consultant: 'c05', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -52, end: null, manager: 'mgr1', fields: CDI(80000, 'Tunis — Lac 2') },
  { key: 'ct07', consultant: 'c07', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -67, end: null, manager: 'mgr3', fields: CDI(96000, 'Tunis — Lac 2') },
  { key: 'ct08', consultant: 'c09', type: 'CDD', template: 'cdd', status: 'SIGNED', start: -17, end: 7, manager: 'mgr2', fields: CDD(56000, "Accroissement temporaire d'activite — projet self-care") },
  { key: 'ct09', consultant: 'c10', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -34, end: null, manager: 'mgr3', fields: CDI(84000, 'Tunis — hybride') },
  { key: 'ct10', consultant: 'c11', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -41, end: null, manager: 'mgr1', fields: CDI(86000, 'Ariana — Ghazela') },
  { key: 'ct11', consultant: 'c12', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -58, end: null, manager: 'mgr2', fields: CDI(90000, 'Tunis — Lac 2') },
  { key: 'ct12', consultant: 'c14', type: 'CDI', template: 'cdi', status: 'SIGNED', start: -29, end: null, manager: 'mgr3', fields: CDI(60000, 'Sfax — Poudriere') },
  // Expired fixed-term contracts, kept for history.
  { key: 'ct13', consultant: 'c13', type: 'CDD', template: 'cdd', status: 'ARCHIVED', start: -20, end: -8, manager: 'mgr1', fields: CDD(38000, 'Premier contrat — sortie de formation') },
  { key: 'ct14', consultant: 'c16', type: 'CDD', template: 'cdd', status: 'ARCHIVED', start: -23, end: -11, manager: 'mgr2', fields: CDD(36000, 'Renfort recette projet Utique') },
  { key: 'ct15', consultant: 'c18', type: 'CDD', template: 'cdd', status: 'ARCHIVED', start: -21, end: -9, manager: 'mgr3', fields: CDD(37000, 'Renfort frontend portail courtiers') },
  // Consultant signed, waiting for the company countersign (RH / DIRECTION).
  { key: 'ct16', consultant: 'c13', type: 'CDI', template: 'cdi', status: 'PENDING_SIGNATURE', start: -1, end: null, manager: 'mgr1', fields: CDI(46000, 'Tunis — Lac 2'), awaitingCountersign: true },
  // In the internal workflow.
  { key: 'ct17', consultant: 'c21', type: 'CDI', template: 'cdi', status: 'INTERNAL_VALIDATION', start: 0, end: null, manager: 'mgr2', fields: CDI(42000, 'Tunis — Lac 2') },
  { key: 'ct18', consultant: 'c22', type: 'CDD', template: 'cdd', status: 'INTERNAL_VALIDATION', start: 1, end: 13, manager: 'mgr3', fields: CDD(40000, 'Projet mobile — surcroit temporaire') },
  { key: 'ct19', consultant: 'c25', type: 'CDI', template: 'cdi', status: 'DRAFT', start: 2, end: null, manager: 'mgr1', fields: CDI(41000, 'Ariana — Ghazela') },
  // Deliberately incomplete: `nomClient` is left out, so `unfilled` is non-empty
  // and PDF generation is refused — the state RH lands in mid-drafting.
  { key: 'ct20', consultant: 'c23', type: 'Régie', template: 'regie', status: 'DRAFT', start: 1, end: 7, manager: 'mgr2', fields: {} },
];

/** Which validation rows a contract in a given status must carry. */
function validationPlan(status: ContractStatus): Array<{ step: ValidationStep; state: 'APPROVED' | 'PENDING' }> {
  switch (status) {
    case 'DRAFT':
      return [];
    case 'INTERNAL_VALIDATION':
      return [
        { step: 'RH', state: 'APPROVED' },
        { step: 'MANAGER', state: 'PENDING' },
        { step: 'DIRECTION', state: 'PENDING' },
      ];
    default:
      return [
        { step: 'RH', state: 'APPROVED' },
        { step: 'MANAGER', state: 'APPROVED' },
        { step: 'DIRECTION', state: 'APPROVED' },
      ];
  }
}

const STEP_STAFF: Record<ValidationStep, string> = { RH: 'rh1', MANAGER: 'mgr1', DIRECTION: 'dir1' };

export interface SeededContract {
  id: string;
  key: string;
  consultantKey: string;
  status: ContractStatus;
  type: string;
  renderedBody: string;
  start: Date;
  companyName: string;
  consultantName: string;
}

export async function seedContracts(
  prisma: PrismaClient,
  staff: StaffMap,
  consultants: Map<string, SeededConsultant>,
  templateIds: Record<TemplateKey, string>,
): Promise<Map<string, SeededContract>> {
  const bodies: Record<TemplateKey, string> = {
    cdi: TEMPLATES[0].body,
    cdd: TEMPLATES[1].body,
    regie: TEMPLATES[2].body,
  };
  const out = new Map<string, SeededContract>();

  for (const [index, row] of CONTRACTS.entries()) {
    const consultant = consultants.get(row.consultant);
    if (!consultant) throw new Error(`Contract ${row.key} references unknown consultant ${row.consultant}`);

    const start = months(row.start);
    const end = row.end === null ? null : months(row.end);
    const manager = staffOf(staff, row.manager);

    const prefill = buildPrefillData({
      template: { body: bodies[row.template] },
      consultant: {
        user: { firstName: consultant.seed.firstName, lastName: consultant.seed.lastName },
        position: consultant.seed.position,
        tjm: consultant.tjm.toFixed(2),
      },
      overrides: { startDate: isoDay(start), ...(end ? { endDate: isoDay(end) } : {}), type: row.type },
      fields: row.fields,
    });

    const signed = row.status === 'SIGNED' || row.status === 'ARCHIVED';
    const consultantName = `${consultant.seed.firstName} ${consultant.seed.lastName}`;
    const companySignatory = `${staffOf(staff, 'rh1').firstName} ${staffOf(staff, 'rh1').lastName}`;
    const id = sid(`contract-${n2(index + 1)}`);

    await prisma.contract.create({
      data: {
        id,
        consultantId: consultant.id,
        templateId: templateIds[row.template],
        managerId: manager.id,
        type: row.type,
        status: row.status,
        prefilledData: prefill as unknown as Prisma.InputJsonValue,
        startDate: start,
        endDate: end,
        archivedAt: row.status === 'ARCHIVED' ? (end ?? days(-30)) : null,
        consultantSignedAt: signed ? days(-1) : row.awaitingCountersign === true ? days(-4) : null,
        consultantSignatoryName: signed || row.awaitingCountersign === true ? consultantName : null,
        companySignedAt: signed ? days(-1) : null,
        companySignatoryName: signed ? companySignatory : null,
        createdAt: new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000),
      },
    });

    // --- validation workflow rows -------------------------------------------
    for (const plan of validationPlan(row.status)) {
      const validator = staffOf(staff, STEP_STAFF[plan.step]);
      await prisma.contractValidation.create({
        data: {
          id: sid(`cval-${n2(index + 1)}-${plan.step.toLowerCase()}`),
          contractId: id,
          step: plan.step,
          state: plan.state,
          validatorId: plan.state === 'APPROVED' ? validator.id : null,
          decidedAt: plan.state === 'APPROVED' ? days(-Math.abs(row.start) - 2) : null,
          comment:
            plan.state === 'APPROVED'
              ? plan.step === 'RH'
                ? 'Dossier complet, grille salariale respectee.'
                : plan.step === 'MANAGER'
                  ? 'Profil et TJM coherents avec le besoin client.'
                  : 'Validation finale Direction.'
              : null,
        },
      });
    }

    out.set(row.key, {
      id,
      key: row.key,
      consultantKey: row.consultant,
      status: row.status,
      type: row.type,
      renderedBody: prefill.renderedBody,
      start,
      companyName: companySignatory,
      consultantName,
    });
  }

  // --- a rejected step, for the timeline's "refuse" branch -------------------
  // The API DELETES all validation rows when a step is rejected (the contract
  // drops back to DRAFT), so a persisted REJECTED row is not something the app
  // produces on its own. It is seeded here only so the red node of the
  // validation timeline is visible in the UI; the audit trail below records the
  // rejection the way the API really would.
  const rejected = out.get('ct19');
  if (rejected) {
    await prisma.contractValidation.create({
      data: {
        id: sid('cval-19-rejected'),
        contractId: rejected.id,
        step: 'MANAGER',
        state: 'REJECTED',
        validatorId: staffOf(staff, 'mgr1').id,
        decidedAt: days(-6),
        comment: "TJM propose au-dessus de la grille pour un profil junior. A revoir avant nouvelle soumission.",
      },
    });
  }

  return out;
}

/** Amendments on contracts already in force. */
export interface SeededContractAmendment {
  id: string;
  contractId: string;
  reason: string;
  effectiveDate: Date;
}

export async function seedContractAmendments(
  prisma: PrismaClient,
  staff: StaffMap,
  contracts: Map<string, SeededContract>,
): Promise<SeededContractAmendment[]> {
  const created: SeededContractAmendment[] = [];
  const rows: Array<{ contract: string; reason: string; changes: Prisma.InputJsonValue; monthsAgo: number; author: string }> = [
    { contract: 'ct01', reason: 'Revalorisation salariale annuelle', changes: { remunerationAnnuelle: { before: '68000', after: '72000' } }, monthsAgo: 8, author: 'rh1' },
    { contract: 'ct04', reason: 'Changement de poste : passage Ingenieur DevOps senior', changes: { position: { before: 'Ingenieur DevOps', after: 'Ingenieur DevOps senior' }, remunerationAnnuelle: { before: '72000', after: '78000' } }, monthsAgo: 14, author: 'rh2' },
    { contract: 'ct06', reason: 'Teletravail porte a 3 jours par semaine', changes: { lieuTravail: { before: 'Tunis — Lac 2 (sur site)', after: 'Tunis — Lac 2 (3j teletravail)' } }, monthsAgo: 5, author: 'rh1' },
    { contract: 'ct08', reason: 'Prolongation du CDD de 6 mois', changes: { endDate: { before: '2026-03-31', after: '2026-09-30' } }, monthsAgo: 3, author: 'rh2' },
    { contract: 'ct09', reason: 'Prime de mission exceptionnelle', changes: { primes: { before: '0', after: '4000' } }, monthsAgo: 11, author: 'rh1' },
    { contract: 'ct11', reason: 'Promotion : Cheffe de projet senior', changes: { position: { before: 'Chef de Projet', after: 'Cheffe de Projet senior' }, remunerationAnnuelle: { before: '84000', after: '90000' } }, monthsAgo: 19, author: 'rh2' },
  ];

  for (const [index, row] of rows.entries()) {
    const contract = contracts.get(row.contract);
    if (!contract) continue;
    const id = sid(`camend-${n2(index + 1)}`);
    const effectiveDate = months(-row.monthsAgo);
    await prisma.contractAmendment.create({
      data: {
        id,
        contractId: contract.id,
        reason: row.reason,
        changes: row.changes,
        effectiveDate,
        createdById: staffOf(staff, row.author).id,
        createdAt: effectiveDate,
      },
    });
    created.push({ id, contractId: contract.id, reason: row.reason, effectiveDate });
  }

  return created;
}
