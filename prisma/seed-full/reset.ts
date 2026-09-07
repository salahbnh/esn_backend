/**
 * Wipes the domain tables before re-seeding.
 *
 * Deletion order is FK-safe and explicit rather than a `TRUNCATE ... CASCADE`,
 * so the script stays readable and fails loudly if a new relation is added
 * without being considered here. Keycloak accounts are deliberately NOT deleted:
 * the seed re-attaches to them by username, which keeps `keycloakId` (and thus
 * anyone's saved browser session) stable across runs.
 */
import type { PrismaClient } from '@prisma/client';

export async function resetDomain(prisma: PrismaClient): Promise<void> {
  // Leaves first, roots last.
  await prisma.aiEvaluation.deleteMany();
  await prisma.application.deleteMany();
  await prisma.jobQuestion.deleteMany();
  await prisma.jobPost.deleteMany();

  await prisma.contractValidation.deleteMany();
  await prisma.contractAmendment.deleteMany();
  await prisma.contract.deleteMany();

  await prisma.assignment.deleteMany();
  await prisma.missionAmendment.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.client.deleteMany();

  await prisma.proposal.deleteMany();
  await prisma.candidateEvaluation.deleteMany();
  await prisma.candidateInteraction.deleteMany();

  // Consultant before Candidate and User — it points at both.
  await prisma.consultant.deleteMany();
  await prisma.candidate.deleteMany();

  await prisma.document.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  // Referential rows are upserted by name, not deleted: dropping ContractTemplate
  // would orphan nothing here, but keeping them stable avoids churning ids that
  // a half-written UI state might still reference.
}
