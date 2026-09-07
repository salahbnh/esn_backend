/**
 * Every document in the dataset — REAL bytes in MinIO, not just metadata rows.
 *
 * Coverage: all seven entity types the documents matrix allows uploads for
 * (CANDIDATE, CONSULTANT, CONTRACT, CONTRACT_TEMPLATE, MISSION, ASSIGNMENT,
 * CLIENT) plus APPLICATION, which only the anonymous portal writes to — those
 * rows keep `uploadedById: null` and the `PUBLIC_UPLOAD_PREFIX` key namespace,
 * exactly like a real public submission. JOB_POST / SKILL / USER are left out on
 * purpose: nothing in the app attaches a file to them (they appear in AuditLog).
 *
 * `scanStatus` is varied deliberately — one INFECTED document exercises the
 * antivirus 403 on download, and a couple of PENDING ones sit in quarantine.
 */
import type { PrismaClient } from '@prisma/client';
import { config } from '../../src/config/env.js';
import { CANDIDATES } from './data-candidates.js';
import { CLIENTS } from './data-names.js';
import { sid, n2 } from './ids.js';
import { createDocument, cvBody } from './storage-docs.js';
import { type Rng, days, frDay, int, pick } from './rng.js';
import type { SeededApplication } from './step-applications.js';
import type { SeededAssignment } from './step-assignments.js';
import type { SeededConsultant } from './step-consultants.js';
import type { SeededContract, SeededContractAmendment } from './step-contracts.js';
import type { MissionsResult } from './step-missions.js';
import type { RecruitmentResult } from './step-recruitment.js';
import { staffOf, type StaffMap } from './step-users.js';
import { SKILL_PROFILES } from './data-skills.js';

export interface DocumentsInput {
  staff: StaffMap;
  candidateIds: Map<string, string>;
  consultants: Map<string, SeededConsultant>;
  contracts: Map<string, SeededContract>;
  contractAmendments: SeededContractAmendment[];
  proposals: RecruitmentResult['proposals'];
  missions: MissionsResult['missions'];
  clientIds: Map<string, string>;
  assignments: SeededAssignment[];
  applications: SeededApplication[];
  templateIds: { cdi: string; cdd: string; regie: string };
}

export async function seedDocuments(prisma: PrismaClient, rng: Rng, input: DocumentsInput): Promise<number> {
  const { staff, candidateIds, consultants, contracts, contractAmendments, proposals } = input;
  const rh1 = staffOf(staff, 'rh1');
  const rh2 = staffOf(staff, 'rh2');
  const mgr1 = staffOf(staff, 'mgr1');
  const dir1 = staffOf(staff, 'dir1');
  let count = 0;

  // --- 1. Candidate CVs -----------------------------------------------------
  for (const [index, c] of CANDIDATES.entries()) {
    const entityId = candidateIds.get(c.key);
    if (!entityId) continue;
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-candcv-${n2(index + 1)}`),
      type: 'CV',
      entityType: 'CANDIDATE',
      entityId,
      filename: `cv-${c.firstName.toLowerCase()}-${c.lastName.toLowerCase().replace(/\s+/g, '-')}.pdf`,
      title: `CV — ${c.firstName} ${c.lastName}`,
      body: cvBody({
        firstName: c.firstName,
        lastName: c.lastName,
        position: c.targetPosition,
        seniority: 'Confirme',
        city: 'Tunis',
        skills: SKILL_PROFILES[c.profile] ?? [],
        years: int(rng, 1, 12),
      }),
      uploadedById: pick(rng, [rh1.id, rh2.id]),
      // Two dossiers are still in AV quarantine, one came back infected.
      scanStatus: index === 7 ? 'PENDING' : index === 13 ? 'INFECTED' : 'CLEAN',
      createdAt: days(-c.appliedDaysAgo),
    });
  }

  // --- 2. Consultant CVs (self-uploaded for half the bench) -----------------
  for (const [index, [, consultant] ] of [...consultants.entries()].entries()) {
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-conscv-${n2(index + 1)}`),
      type: 'CV',
      entityType: 'CONSULTANT',
      entityId: consultant.id,
      filename: `cv-esn-${consultant.seed.firstName.toLowerCase()}-${consultant.seed.lastName.toLowerCase().replace(/\s+/g, '-')}.pdf`,
      title: `CV ESN — ${consultant.seed.firstName} ${consultant.seed.lastName}`,
      body: cvBody({
        firstName: consultant.seed.firstName,
        lastName: consultant.seed.lastName,
        position: consultant.seed.position,
        seniority: consultant.seed.seniority,
        city: consultant.city,
        skills: consultant.skills,
        years: Math.max(1, Math.round(consultant.seed.tenureMonths / 12) + int(rng, 1, 4)),
      }),
      // Consultants may upload to their OWN profile — half of these are theirs.
      uploadedById: index % 2 === 0 ? consultant.userId : rh1.id,
      createdAt: days(-int(rng, 30, 400)),
    });
  }

  // --- 3. Generated contract PDFs + wet-signed scans -------------------------
  let contractDocIndex = 0;
  for (const contract of contracts.values()) {
    if (contract.status === 'DRAFT') continue; // nothing generated yet
    contractDocIndex += 1;
    count += 1;
    const docId = await createDocument(prisma, {
      id: sid(`doc-contract-${n2(contractDocIndex)}`),
      type: 'CONTRACT',
      entityType: 'CONTRACT',
      entityId: contract.id,
      filename: `contrat-${contract.key}.pdf`,
      title: 'Contrat de travail',
      body: contract.renderedBody,
      uploadedById: rh1.id,
      createdAt: contract.start,
    });

    const signedScan = contract.status === 'SIGNED' && contractDocIndex % 4 === 1;
    let signedPdfId: string | null = null;
    if (signedScan) {
      contractDocIndex += 1;
      count += 1;
      signedPdfId = await createDocument(prisma, {
        id: sid(`doc-contract-${n2(contractDocIndex)}`),
        type: 'CONTRACT',
        entityType: 'CONTRACT',
        entityId: contract.id,
        filename: `contrat-${contract.key}-signe.pdf`,
        title: 'Contrat de travail — exemplaire signe',
        body: `${contract.renderedBody}\n\nSIGNATURES\nConsultant — ${contract.consultantName} — le ${frDay(days(-1))}\nESN — ${contract.companyName} — le ${frDay(days(-1))}`,
        uploadedById: rh1.id,
        createdAt: days(-1),
      });
    }

    await prisma.contract.update({
      where: { id: contract.id },
      data: { generatedPdfId: docId, signedPdfId },
    });
  }

  // --- 4. Contract amendment PDFs -------------------------------------------
  for (const [index, amendment] of contractAmendments.entries()) {
    count += 1;
    const docId = await createDocument(prisma, {
      id: sid(`doc-camend-${n2(index + 1)}`),
      type: 'CONTRACT_AMENDMENT',
      entityType: 'CONTRACT',
      entityId: amendment.contractId,
      filename: `avenant-${n2(index + 1)}.pdf`,
      title: 'Avenant au contrat de travail',
      body: [
        'AVENANT AU CONTRAT DE TRAVAIL',
        '',
        `Motif : ${amendment.reason}`,
        `Date d'effet : ${frDay(amendment.effectiveDate)}`,
        '',
        "Les autres clauses du contrat initial demeurent inchangees.",
        '',
        'Fait a Tunis, en deux exemplaires originaux.',
      ].join('\n'),
      uploadedById: rh2.id,
      createdAt: amendment.effectiveDate,
    });
    await prisma.contractAmendment.update({ where: { id: amendment.id }, data: { generatedPdfId: docId } });
  }

  // --- 5. Proposal PDFs ------------------------------------------------------
  for (const [index, proposal] of proposals.entries()) {
    count += 1;
    const docId = await createDocument(prisma, {
      id: sid(`doc-proposal-${n2(index + 1)}`),
      type: 'PROPOSAL',
      entityType: 'CANDIDATE',
      entityId: proposal.candidateId,
      filename: `proposition-${n2(index + 1)}.pdf`,
      title: "Proposition d'embauche",
      body: [
        "PROPOSITION D'EMBAUCHE",
        '',
        `Poste propose : ${proposal.position}`,
        `Etablie le ${frDay(proposal.createdAt)}`,
        '',
        "Cette proposition est valable 15 jours a compter de sa date d'emission.",
        "Elle sera suivie d'un contrat de travail formalise apres acceptation.",
        '',
        'ESN Tunisie — Direction des Ressources Humaines',
      ].join('\n'),
      uploadedById: rh1.id,
      createdAt: proposal.createdAt,
    });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { documentId: docId } });
  }

  // --- 6. Mission documents --------------------------------------------------
  for (const [index, mission] of input.missions.slice(0, 8).entries()) {
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-mission-${n2(index + 1)}`),
      type: 'MISSION_DOC',
      entityType: 'MISSION',
      entityId: mission.id,
      filename: `cadrage-mission-${n2(index + 1)}.pdf`,
      title: `Note de cadrage — ${mission.project}`,
      body: [
        `NOTE DE CADRAGE — ${mission.project.toUpperCase()}`,
        '',
        'OBJECTIFS',
        '  - Cadrer le perimetre fonctionnel et technique de la mission.',
        '  - Definir les livrables et le calendrier de recette.',
        '  - Formaliser les interlocuteurs cote client et cote ESN.',
        '',
        'GOUVERNANCE',
        '  Comite de suivi hebdomadaire (1h) + comite de pilotage mensuel.',
        '',
        `TJM DE REFERENCE : ${mission.tjm} TND`,
        '',
        'Document interne ESN — diffusion restreinte.',
      ].join('\n'),
      uploadedById: mgr1.id,
      createdAt: days(mission.start - 10),
    });
  }

  // --- 7. Assignment documents (ordres de mission) ---------------------------
  for (const [index, assignment] of input.assignments.filter((a) => a.status === 'ACTIVE').slice(0, 4).entries()) {
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-assign-${n2(index + 1)}`),
      type: 'MISSION_DOC',
      entityType: 'ASSIGNMENT',
      entityId: assignment.id,
      filename: `ordre-de-mission-${n2(index + 1)}.pdf`,
      title: 'Ordre de mission',
      body: [
        'ORDRE DE MISSION',
        '',
        `Role sur la mission : ${assignment.role}`,
        '',
        "Le consultant est missionne aupres du client dans les conditions definies",
        "par le contrat de prestation en vigueur. Les frais de deplacement sont pris",
        "en charge selon la politique interne.",
        '',
        'ESN Tunisie — Direction des Operations',
      ].join('\n'),
      uploadedById: mgr1.id,
      createdAt: days(-int(rng, 20, 200)),
    });
  }

  // --- 8. Client documents ---------------------------------------------------
  for (const [index, client] of CLIENTS.slice(0, 4).entries()) {
    const entityId = input.clientIds.get(client.slug);
    if (!entityId) continue;
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-client-${n2(index + 1)}`),
      type: index === 3 ? 'OTHER' : 'MISSION_DOC',
      entityType: 'CLIENT',
      entityId,
      filename: index === 3 ? `nda-${client.slug}.pdf` : `contrat-cadre-${client.slug}.pdf`,
      title: index === 3 ? `Accord de confidentialite — ${client.name}` : `Contrat cadre — ${client.name}`,
      body: [
        index === 3 ? 'ACCORD DE CONFIDENTIALITE' : 'CONTRAT CADRE DE PRESTATION',
        '',
        `Entre ESN Tunisie et ${client.name} (${client.industry}).`,
        `Interlocuteur client : ${client.contactFirst} ${client.contactLast}.`,
        '',
        "Le present document fixe les conditions generales applicables a l'ensemble",
        'des missions confiees par le client, chaque mission faisant ensuite',
        "l'objet d'un bon de commande specifique.",
      ].join('\n'),
      uploadedById: index % 2 === 0 ? mgr1.id : dir1.id,
      // One archived document, to show the soft-delete state in the list.
      archivedAt: index === 2 ? days(-15) : null,
      createdAt: days(-int(rng, 200, 700)),
    });
  }

  // --- 9. Contract template reference ---------------------------------------
  count += 1;
  await createDocument(prisma, {
    id: sid('doc-template-01'),
    type: 'OTHER',
    entityType: 'CONTRACT_TEMPLATE',
    entityId: input.templateIds.cdi,
    filename: 'notice-modele-cdi.pdf',
    title: 'Notice d\'utilisation — modele CDI',
    body: [
      "NOTICE — MODELE DE CONTRAT CDI",
      '',
      'Champs remplis automatiquement : firstName, lastName, position, tjm,',
      'startDate, endDate, type.',
      '',
      'Champs a completer par les RH avant generation du PDF :',
      '  - lieuTravail',
      '  - remunerationAnnuelle',
      '  - periodeEssai',
      '',
      "Tant qu'un champ manuel reste vide, la generation du PDF est refusee.",
    ].join('\n'),
    uploadedById: rh1.id,
    createdAt: days(-500),
  });

  // --- 10. Public application uploads (anonymous: uploadedById stays null) ---
  for (const [index, app] of input.applications.filter((a) => a.status !== 'SPAM').slice(0, 22).entries()) {
    count += 1;
    await createDocument(prisma, {
      id: sid(`doc-appcv-${n2(index + 1)}`),
      type: 'CV',
      entityType: 'APPLICATION',
      entityId: app.id,
      keyPrefix: config.PUBLIC_UPLOAD_PREFIX,
      filename: `cv-${app.firstName.toLowerCase()}-${app.lastName.toLowerCase().replace(/\s+/g, '-')}.pdf`,
      title: `CV — ${app.firstName} ${app.lastName}`,
      body: cvBody({
        firstName: app.firstName,
        lastName: app.lastName,
        position: 'Candidat',
        seniority: 'Confirme',
        city: 'Tunis',
        skills: SKILL_PROFILES['fullstack'] ?? [],
        years: int(rng, 1, 10),
      }),
      uploadedById: null,
      createdAt: app.createdAt,
    });

    // Roughly a third of applicants also attach a cover letter.
    if (index % 3 === 0) {
      count += 1;
      await createDocument(prisma, {
        id: sid(`doc-applm-${n2(index + 1)}`),
        type: 'COVER_LETTER',
        entityType: 'APPLICATION',
        entityId: app.id,
        keyPrefix: config.PUBLIC_UPLOAD_PREFIX,
        filename: `lettre-motivation-${app.lastName.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        title: 'Lettre de motivation',
        body: [
          `Madame, Monsieur,`,
          '',
          "Actuellement en recherche d'un nouveau defi, je souhaite rejoindre vos equipes",
          "pour intervenir sur des projets clients exigeants. Mon parcours m'a permis de",
          'travailler en methodologie agile, en relation directe avec les metiers, et de',
          'mener des mises en production sensibles.',
          '',
          "Je reste a votre disposition pour un entretien.",
          '',
          `${app.firstName} ${app.lastName}`,
        ].join('\n'),
        uploadedById: null,
        scanStatus: index === 6 ? 'PENDING' : 'CLEAN',
        createdAt: app.createdAt,
      });
    }
  }

  return count;
}
