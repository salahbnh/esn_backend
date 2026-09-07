/**
 * Candidates and everything hanging off them: interactions, evaluations and
 * proposals.
 *
 * Volume follows the pipeline stage — an APPLIED candidate has one touchpoint
 * and no evaluation, a HIRED one has a full history — so the candidate detail
 * page tells a coherent story instead of showing uniformly noisy data.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { CANDIDATES, type CandidateSeed } from './data-candidates.js';
import { SKILL_PROFILES } from './data-skills.js';
import { sid, n2 } from './ids.js';
import { type Rng, days, int, pick, sample } from './rng.js';
import type { SeededJobPost } from './step-job-posts.js';
import { staffOf, type StaffMap } from './step-users.js';

/** How many touchpoints / evaluations each pipeline stage carries. */
const DEPTH: Record<string, { interactions: number; evaluations: number }> = {
  APPLIED: { interactions: 1, evaluations: 0 },
  INTERVIEW: { interactions: 3, evaluations: 1 },
  VALIDATED: { interactions: 4, evaluations: 2 },
  HIRED: { interactions: 5, evaluations: 2 },
  REJECTED: { interactions: 3, evaluations: 1 },
};

const INTERACTION_SCRIPT: Array<{ type: string; summary: (c: CandidateSeed) => string }> = [
  { type: 'EMAIL', summary: (c) => `Accuse de reception de la candidature pour le poste de ${c.targetPosition}. CV transmis au manager concerne.` },
  { type: 'CALL', summary: (c) => `Appel de qualification (20 min) : parcours, disponibilite et pretentions. Profil coherent avec le besoin ${c.targetPosition}.` },
  { type: 'INTERVIEW', summary: () => 'Entretien technique (1h) : exercice de conception + questions sur les projets passes. Bon niveau general.' },
  { type: 'INTERVIEW', summary: () => 'Entretien manager (45 min) : posture client, travail en equipe, mobilite. Retour positif.' },
  { type: 'NOTE', summary: () => 'Synthese du process partagee avec la Direction pour arbitrage final.' },
];

const CRITERIA_LABELS = ['technique', 'communication', 'motivation', 'adequationPoste', 'autonomie'] as const;

export interface RecruitmentResult {
  /** candidate key -> row id */
  candidateIds: Map<string, string>;
  /** proposals created, so documents can be attached to them afterwards */
  proposals: Array<{ id: string; candidateKey: string; candidateId: string; position: string; createdAt: Date }>;
}

export async function seedRecruitment(
  prisma: PrismaClient,
  rng: Rng,
  staff: StaffMap,
  skillIds: Map<string, string>,
  jobPosts: Map<string, SeededJobPost>,
): Promise<RecruitmentResult> {
  const candidateIds = new Map<string, string>();
  const proposals: RecruitmentResult['proposals'] = [];

  const rhKeys = ['rh1', 'rh2'];
  const managerKeys = ['mgr1', 'mgr2', 'mgr3'];

  for (const [index, c] of CANDIDATES.entries()) {
    const id = sid(`candidate-${n2(index + 1)}`);
    const createdAt = days(-c.appliedDaysAgo);
    const jobPostId = c.fromJobPost ? (jobPosts.get(c.fromJobPost)?.id ?? null) : null;

    const skills = sample(rng, SKILL_PROFILES[c.profile] ?? [], int(rng, 3, 5))
      .map((name) => skillIds.get(name))
      .filter((skillId): skillId is string => skillId !== undefined);

    await prisma.candidate.create({
      data: {
        id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        // Tunisian mobile numbering plan: +216 followed by 8 digits.
        phone: `+216 ${int(rng, 20, 29)} ${String(int(rng, 100, 999))} ${String(int(rng, 100, 999))}`,
        status: c.status,
        source: c.source,
        targetPosition: c.targetPosition,
        notes: c.notes === '' ? null : c.notes,
        jobPostId,
        createdAt,
        skills: { connect: skills.map((skillId) => ({ id: skillId })) },
      },
    });
    candidateIds.set(c.key, id);

    const depth = DEPTH[c.status] ?? { interactions: 1, evaluations: 0 };

    // --- interactions: spread between the application date and today --------
    for (let i = 0; i < depth.interactions; i += 1) {
      const script = INTERACTION_SCRIPT[i];
      if (!script) break;
      const offset = Math.round((c.appliedDaysAgo * (depth.interactions - i)) / (depth.interactions + 1));
      await prisma.candidateInteraction.create({
        data: {
          id: sid(`cint-${n2(index + 1)}-${n2(i + 1)}`),
          candidateId: id,
          type: script.type,
          occurredAt: days(-offset),
          summary: script.summary(c),
          authorId: staffOf(staff, pick(rng, i >= 3 ? managerKeys : rhKeys)).id,
          createdAt: days(-offset),
        },
      });
    }

    // --- evaluations --------------------------------------------------------
    for (let i = 0; i < depth.evaluations; i += 1) {
      // Rejected candidates score low; hired ones high — the numbers must agree
      // with the decision, otherwise the reporting screens look nonsensical.
      const band: [number, number] =
        c.status === 'REJECTED' ? [3, 6] : c.status === 'HIRED' ? [7, 10] : [6, 9];
      const criteria: Record<string, number> = {};
      for (const label of CRITERIA_LABELS) criteria[label] = int(rng, band[0], band[1]);
      const values = Object.values(criteria);
      const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

      await prisma.candidateEvaluation.create({
        data: {
          id: sid(`ceval-${n2(index + 1)}-${n2(i + 1)}`),
          candidateId: id,
          evaluatorId: staffOf(staff, i === 0 ? pick(rng, rhKeys) : pick(rng, managerKeys)).id,
          criteria: criteria as Prisma.InputJsonValue,
          overallScore: overall,
          recommendation:
            c.status === 'REJECTED' ? 'NON_RETENU' : overall >= 8 ? 'A_RECRUTER' : 'A_REVOIR',
          comment:
            c.status === 'REJECTED'
              ? 'Niveau en deca du besoin sur la partie technique. Dossier clos.'
              : i === 0
                ? 'Bon fond technique, communication claire. A confirmer en entretien manager.'
                : 'Confirme apres entretien manager : profil aligne avec le besoin client.',
          createdAt: days(-Math.round(c.appliedDaysAgo / (i + 2))),
        },
      });
    }

    // --- proposals: only for candidates that reached the offer stage ---------
    if (c.status === 'VALIDATED' || c.status === 'HIRED') {
      const status = c.status === 'HIRED' ? 'ACCEPTED' : pick(rng, ['DRAFT', 'SENT', 'SENT', 'DECLINED']);
      const proposalId = sid(`proposal-${n2(index + 1)}`);
      const proposalDate = days(-Math.max(3, Math.round(c.appliedDaysAgo / 4)));
      const content = {
        contractType: c.status === 'HIRED' ? 'CDI' : pick(rng, ['CDI', 'CDD']),
        position: c.targetPosition,
        tjm: String(int(rng, 32, 70) * 10),
        startDate: days(int(rng, 10, 60)).toISOString().slice(0, 10),
        duration: c.status === 'HIRED' ? 'Indeterminee' : pick(rng, ['12 mois', '18 mois', 'Indeterminee']),
        notes: `Proposition etablie apres validation du parcours ${c.targetPosition}. Periode d'essai de 3 mois renouvelable une fois.`,
      };

      await prisma.proposal.create({
        data: {
          id: proposalId,
          candidateId: id,
          status,
          content: content as Prisma.InputJsonValue,
          createdAt: proposalDate,
        },
      });
      proposals.push({ id: proposalId, candidateKey: c.key, candidateId: id, position: c.targetPosition, createdAt: proposalDate });
    }
  }

  return { candidateIds, proposals };
}
