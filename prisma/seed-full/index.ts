/**
 * Full, realistic ESN dataset — Tunisian identities, every table populated and
 * every relation wired.
 *
 *   npm run seed:full        (from backend/)
 *
 * Requires the docker-compose stack to be up: Postgres for the rows, MinIO for
 * the document bytes, Keycloak for the login accounts. The script fails fast
 * with an actionable message if Keycloak is unreachable, BEFORE touching the DB.
 *
 * It is destructive and idempotent: every domain table is wiped and rebuilt from
 * the fixture, while Keycloak accounts are matched by username and reused, so
 * `keycloakId` values (and therefore existing sessions) survive a re-run. A
 * fixed PRNG seed makes two runs produce identical data.
 *
 * Ordering follows the foreign keys: reference -> staff -> clients/missions ->
 * offers -> candidates -> applications -> consultants -> staffing -> contracts
 * -> documents -> audit.
 */
import { PrismaClient } from '@prisma/client';
import { createRng, TODAY } from './rng.js';
import { resetDomain } from './reset.js';
import { purgeBucket } from './storage-docs.js';
import { assertKeycloakReachable, SEED_PASSWORD } from './keycloak.js';
import { seedReference } from './step-reference.js';
import { seedStaff, STAFF } from './step-users.js';
import { seedClientsAndMissions } from './step-missions.js';
import { seedJobPosts } from './step-job-posts.js';
import { seedRecruitment } from './step-recruitment.js';
import { seedApplications } from './step-applications.js';
import { seedAiEvaluations } from './step-ai-evaluations.js';
import { seedConsultants } from './step-consultants.js';
import { seedAssignments } from './step-assignments.js';
import { seedContracts, seedContractAmendments } from './step-contracts.js';
import { seedDocuments } from './step-documents.js';
import { seedAuditLog } from './step-audit.js';
import { CONSULTANTS } from './data-consultants.js';

const prisma = new PrismaClient();

/** Fixed seed — change it only if you want a different (but still stable) draw. */
const RNG_SEED = 20260906;

function step(message: string): void {
  console.log(`  → ${message}`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const rng = createRng(RNG_SEED);

  console.log('\nESN — jeu de donnees complet (identites tunisiennes)');
  console.log(`  Date de reference : ${TODAY.toISOString().slice(0, 10)}` +
    (process.env['SEED_ANCHOR_DATE'] ? '  (figee via SEED_ANCHOR_DATE)' : '  (aujourd hui)') + '\n');

  step('Verification de Keycloak…');
  await assertKeycloakReachable();

  step('Nettoyage des tables métier…');
  await resetDomain(prisma);

  // The reset orphans every stored object; drop them so re-runs do not pile up
  // unreferenced files in the bucket.
  const purged = await purgeBucket();
  step(`Purge du bucket MinIO (${purged} objets supprimés)`);

  step('Référentiel : compétences + modèles de contrat');
  const { skillIds, templateIds } = await seedReference(prisma);

  step(`Utilisateurs internes (${STAFF.length}) + comptes Keycloak`);
  const staff = await seedStaff(prisma);

  step('Clients + missions');
  const { clientIds, missions } = await seedClientsAndMissions(prisma, rng, skillIds);

  step("Offres d'emploi + questions du portail");
  const jobPosts = await seedJobPosts(prisma, staff, skillIds);

  step('Candidats + échanges + évaluations + propositions');
  const { candidateIds, proposals } = await seedRecruitment(prisma, rng, staff, skillIds, jobPosts);

  step('Candidatures reçues via le portail public');
  const applications = await seedApplications(prisma, rng, staff, jobPosts, candidateIds);

  step('Évaluations IA des candidatures');
  const aiCount = await seedAiEvaluations(prisma, rng, staff, applications);

  step(`Consultants (${CONSULTANTS.length}) + comptes Keycloak`);
  const consultants = await seedConsultants(prisma, rng, skillIds, candidateIds);

  step('Affectations + avenants de mission');
  const assignments = await seedAssignments(prisma, rng, missions, consultants, staff);

  step('Contrats + circuit de validation');
  const contracts = await seedContracts(prisma, staff, consultants, templateIds);
  const contractAmendments = await seedContractAmendments(prisma, staff, contracts);

  step('Documents (PDF réels déposés dans MinIO)…');
  const documentCount = await seedDocuments(prisma, rng, {
    staff, candidateIds, consultants, contracts, contractAmendments, proposals,
    missions, clientIds, assignments, applications, templateIds,
  });

  step("Journal d'audit");
  const auditCount = await seedAuditLog(prisma, rng, {
    staff, candidateIds, consultants, clientIds, missions, assignments,
    contracts, jobPosts, applications, skillIds, templateIds,
  });

  // --- summary --------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    skills: await prisma.skill.count(),
    clients: await prisma.client.count(),
    missions: await prisma.mission.count(),
    assignments: await prisma.assignment.count(),
    missionAmendments: await prisma.missionAmendment.count(),
    candidates: await prisma.candidate.count(),
    interactions: await prisma.candidateInteraction.count(),
    evaluations: await prisma.candidateEvaluation.count(),
    proposals: await prisma.proposal.count(),
    consultants: await prisma.consultant.count(),
    contractTemplates: await prisma.contractTemplate.count(),
    contracts: await prisma.contract.count(),
    contractValidations: await prisma.contractValidation.count(),
    contractAmendments: await prisma.contractAmendment.count(),
    jobPosts: await prisma.jobPost.count(),
    jobQuestions: await prisma.jobQuestion.count(),
    applications: await prisma.application.count(),
    aiEvaluations: await prisma.aiEvaluation.count(),
    documents: await prisma.document.count(),
    auditLogs: await prisma.auditLog.count(),
  };

  console.log('\n  Tables remplies :');
  for (const [table, value] of Object.entries(counts)) {
    console.log(`    ${table.padEnd(20)} ${String(value).padStart(4)}`);
  }
  console.log(
    `\n  ${documentCount} documents déposés dans MinIO · ${aiCount} évaluations IA · ${auditCount} entrées d'audit`,
  );
  console.log(`\n  Mot de passe de tous les comptes : "${SEED_PASSWORD}"`);
  console.log(`  Connexions : rh@esn.local · manager@esn.local · direction@esn.local · consultant@esn.local`);
  console.log(`\n  Terminé en ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed échoué :', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
