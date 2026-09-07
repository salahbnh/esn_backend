/**
 * Public-portal applications + their AI evaluations.
 *
 * Two families of rows:
 *  - LINKED applications, generated from the candidates that carry a
 *    `fromJobPost`: the Application and the Candidate describe the SAME person,
 *    which is exactly what "RH links a candidature into the ATS" produces.
 *  - everything still in the funnel (SUBMITTED / UNDER_REVIEW / REJECTED / SPAM)
 *    from `EXTRA_APPLICANTS`.
 *
 * `answers` is an immutable snapshot: `{ key, label, type, value }` per question,
 * frozen at submit time — that is why an archived question still shows up on an
 * older application.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { CANDIDATES } from './data-candidates.js';
import { EXTRA_APPLICANTS } from './data-applicants.js';
import { SKILL_PROFILES } from './data-skills.js';
import { sid, n2 } from './ids.js';
import { type Rng, days, int, pick, sample } from './rng.js';
import type { SeededJobPost } from './step-job-posts.js';
import { staffOf, type StaffMap } from './step-users.js';

const SHORT_ANSWERS = ['Immediate', 'Sous 1 mois', 'Sous 2 mois', 'Preavis de 3 mois'];
const LINK_ANSWERS = ['https://github.com/exemple', 'https://portfolio.example.tn', ''];

/** One answer value, shaped by the question type + its config. */
function answerFor(rng: Rng, q: { key: string; type: string }, options: string[] | undefined, years: number): unknown {
  switch (q.type) {
    case 'NUMBER':
      return q.key === 'tjm' ? int(rng, 350, 750) : years;
    case 'BOOLEAN':
      return rng() > 0.25;
    case 'SINGLE_CHOICE':
      return options && options.length > 0 ? pick(rng, options) : 'Autre';
    case 'MULTI_CHOICE':
      return options && options.length > 0 ? sample(rng, options, int(rng, 1, Math.min(3, options.length))) : [];
    case 'LONG_TEXT':
      return "J'ai pilote plusieurs projets de bout en bout, de la conception a la mise en production, en equipe agile. Je recherche un environnement ESN pour intervenir sur des contextes clients varies et continuer a monter en competence sur des architectures distribuees.";
    default:
      return q.key === 'portfolio' ? pick(rng, LINK_ANSWERS) : pick(rng, SHORT_ANSWERS);
  }
}

function buildAnswers(rng: Rng, post: SeededJobPost, years: number): Prisma.InputJsonValue {
  return post.seed.questions.map((q) => ({
    key: q.key,
    label: q.label,
    type: q.type,
    value: answerFor(rng, q, q.options, years),
  })) as unknown as Prisma.InputJsonValue;
}

export interface SeededApplication {
  id: string;
  jobPostSlug: string;
  candidateKey: string | null;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: Date;
}

export async function seedApplications(
  prisma: PrismaClient,
  rng: Rng,
  staff: StaffMap,
  jobPosts: Map<string, SeededJobPost>,
  candidateIds: Map<string, string>,
): Promise<SeededApplication[]> {
  const out: SeededApplication[] = [];
  let index = 0;

  // --- applications that RH already linked into the ATS ---------------------
  for (const c of CANDIDATES) {
    if (!c.fromJobPost) continue;
    const post = jobPosts.get(c.fromJobPost);
    const candidateId = candidateIds.get(c.key);
    if (!post || !candidateId) continue;

    index += 1;
    const createdAt = days(-c.appliedDaysAgo);
    const reviewer = staffOf(staff, pick(rng, ['rh1', 'rh2']));
    const id = sid(`application-${n2(index)}`);

    await prisma.application.create({
      data: {
        id,
        jobPostId: post.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: `+216 ${int(rng, 20, 29)} ${int(rng, 100, 999)} ${int(rng, 100, 999)}`,
        consentAcceptedAt: createdAt,
        // Title is snapshotted so a later rename of the offer cannot rewrite history.
        jobTitleSnapshot: post.seed.title,
        answers: buildAnswers(rng, post, int(rng, 1, 9)),
        declaredSkills: sample(rng, SKILL_PROFILES[c.profile] ?? [], int(rng, 3, 5)).map((name) => ({
          name,
        })) as unknown as Prisma.InputJsonValue,
        status: 'LINKED',
        candidateId,
        reviewedById: reviewer.id,
        reviewedAt: days(-Math.max(1, c.appliedDaysAgo - int(rng, 1, 4))),
        createdAt,
      },
    });
    out.push({ id, jobPostSlug: c.fromJobPost, candidateKey: c.key, firstName: c.firstName, lastName: c.lastName, status: 'LINKED', createdAt });
  }

  // --- the rest of the funnel ----------------------------------------------
  for (const a of EXTRA_APPLICANTS) {
    const post = jobPosts.get(a.jobPost);
    if (!post) continue;
    index += 1;
    const createdAt = days(-a.daysAgo);
    const reviewed = a.status === 'UNDER_REVIEW' || a.status === 'REJECTED' || a.status === 'SPAM';
    const id = sid(`application-${n2(index)}`);

    await prisma.application.create({
      data: {
        id,
        jobPostId: post.id,
        firstName: a.firstName,
        lastName: a.lastName,
        email: a.email,
        phone: a.status === 'SPAM' ? null : `+216 ${int(rng, 20, 29)} ${int(rng, 100, 999)} ${int(rng, 100, 999)}`,
        consentAcceptedAt: createdAt,
        jobTitleSnapshot: post.seed.title,
        answers:
          a.status === 'SPAM'
            ? ([{ key: 'dispo', label: 'Disponibilite', type: 'SHORT_TEXT', value: 'VISIT OUR WEBSITE!!! cheap backlinks' }] as unknown as Prisma.InputJsonValue)
            : buildAnswers(rng, post, int(rng, 0, 8)),
        declaredSkills:
          a.status === 'SPAM'
            ? undefined
            : (sample(rng, SKILL_PROFILES[post.seed.profile] ?? [], int(rng, 2, 4)).map((name) => ({
                name,
              })) as unknown as Prisma.InputJsonValue),
        status: a.status,
        reviewedById: reviewed ? staffOf(staff, pick(rng, ['rh1', 'rh2'])).id : null,
        reviewedAt: reviewed ? days(-Math.max(0, a.daysAgo - int(rng, 1, 3))) : null,
        rejectionReason: a.rejectionReason ?? null,
        createdAt,
      },
    });
    out.push({ id, jobPostSlug: a.jobPost, candidateKey: null, firstName: a.firstName, lastName: a.lastName, status: a.status, createdAt });
  }

  return out;
}
