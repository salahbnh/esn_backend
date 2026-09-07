/**
 * Job posts + their custom questions.
 *
 * `publicToken` is normally a 128-bit CSPRNG value. Here it is DERIVED from the
 * slug with a sha-256 so the public URL of a given offer is stable across seed
 * runs (you can bookmark /jobs/<token> while developing). That trade-off is
 * acceptable only because this is a throwaway dev dataset — the real generator
 * in `job-posts.service` stays random.
 */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { JOB_POSTS, type JobPostSeed } from './data-job-posts.js';
import { SKILL_PROFILES } from './data-skills.js';
import { sid, n2 } from './ids.js';
import { days } from './rng.js';
import { staffOf, type StaffMap } from './step-users.js';

export interface SeededJobPost {
  seed: JobPostSeed;
  id: string;
  publicToken: string;
  /** Question key -> its label/type, for building answer snapshots. */
  questions: Array<{ key: string; label: string; type: string; archived: boolean }>;
}

function deriveToken(slug: string): string {
  return createHash('sha256').update(`esn-seed-portal:${slug}`).digest('hex').slice(0, 32);
}

export async function seedJobPosts(
  prisma: PrismaClient,
  staff: StaffMap,
  skillIds: Map<string, string>,
): Promise<Map<string, SeededJobPost>> {
  const result = new Map<string, SeededJobPost>();

  for (const [index, post] of JOB_POSTS.entries()) {
    const author = staffOf(staff, post.author);
    const id = sid(`jobpost-${n2(index + 1)}`);
    const publicToken = deriveToken(post.slug);
    const createdAt = days(-(post.publishedDaysAgo ?? 10) - 7);

    const requiredSkills = (SKILL_PROFILES[post.profile] ?? [])
      .map((name) => skillIds.get(name))
      .filter((skillId): skillId is string => skillId !== undefined);

    await prisma.jobPost.create({
      data: {
        id,
        title: post.title,
        description: post.description,
        requirements: post.requirements,
        location: post.location,
        employmentType: post.employmentType,
        seniorityLevel: post.seniorityLevel,
        minYearsExperience: post.minYearsExperience,
        status: post.status,
        publicToken,
        publishedAt: post.publishedDaysAgo === null ? null : days(-post.publishedDaysAgo),
        expiresAt: post.expiresInDays === null ? null : days(post.expiresInDays),
        authorId: author.id,
        createdAt,
        requiredSkills: { connect: requiredSkills.map((skillId) => ({ id: skillId })) },
      },
    });

    const questions: SeededJobPost['questions'] = [];
    for (const [qIndex, q] of post.questions.entries()) {
      await prisma.jobQuestion.create({
        data: {
          id: sid(`jobq-${n2(index + 1)}-${n2(qIndex + 1)}`),
          jobPostId: id,
          key: q.key,
          label: q.label,
          type: q.type,
          required: q.required,
          // Nullable Json columns: omit the key rather than passing `null`
          // (Prisma reserves `null` for JsonNull/DbNull on Json? fields).
          ...(q.options ? { options: q.options as Prisma.InputJsonValue } : {}),
          ...(q.config ? { config: q.config as Prisma.InputJsonValue } : {}),
          order: qIndex + 1,
          helpText: q.helpText ?? null,
          archivedAt: q.archived === true ? days(-5) : null,
          createdAt,
        },
      });
      questions.push({ key: q.key, label: q.label, type: q.type, archived: q.archived === true });
    }

    result.set(post.slug, { seed: post, id, publicToken, questions });
  }

  return result;
}
