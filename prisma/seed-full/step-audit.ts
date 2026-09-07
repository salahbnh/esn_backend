/**
 * The audit trail.
 *
 * This is the one place where ALL eleven `EntityType` values appear — including
 * SKILL, USER and JOB_POST, which never carry documents but are absolutely
 * audited when someone creates, publishes or deactivates them. Entries are
 * derived from the data that was just seeded, so every `entityId` resolves to a
 * row that exists and every `actorId` is a real user.
 *
 * `payload` mirrors what the services write: a small diff or a set of details,
 * never a full PII dump.
 */
import type { EntityType, Prisma, PrismaClient } from '@prisma/client';
import { CANDIDATES } from './data-candidates.js';
import { JOB_POSTS } from './data-job-posts.js';
import { CLIENTS } from './data-names.js';
import { SKILLS } from './data-skills.js';
import { STAFF, staffOf, type StaffMap } from './step-users.js';
import { type Rng, days, int, pick } from './rng.js';
import type { SeededApplication } from './step-applications.js';
import type { SeededAssignment } from './step-assignments.js';
import type { SeededConsultant } from './step-consultants.js';
import type { SeededContract } from './step-contracts.js';
import type { MissionsResult } from './step-missions.js';
import type { SeededJobPost } from './step-job-posts.js';

interface AuditRow {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorId: string | null;
  payload: Prisma.InputJsonValue;
  createdAt: Date;
}

export interface AuditInput {
  staff: StaffMap;
  candidateIds: Map<string, string>;
  consultants: Map<string, SeededConsultant>;
  clientIds: Map<string, string>;
  missions: MissionsResult['missions'];
  assignments: SeededAssignment[];
  contracts: Map<string, SeededContract>;
  jobPosts: Map<string, SeededJobPost>;
  applications: SeededApplication[];
  skillIds: Map<string, string>;
  templateIds: { cdi: string; cdd: string; regie: string };
}

export async function seedAuditLog(prisma: PrismaClient, rng: Rng, input: AuditInput): Promise<number> {
  const { staff } = input;
  const rhIds = ['rh1', 'rh2'].map((k) => staffOf(staff, k).id);
  const mgrIds = ['mgr1', 'mgr2', 'mgr3'].map((k) => staffOf(staff, k).id);
  const dirId = staffOf(staff, 'dir1').id;
  const rows: AuditRow[] = [];

  // --- SKILL ---------------------------------------------------------------
  for (const skill of SKILLS.slice(0, 6)) {
    const id = input.skillIds.get(skill.name);
    if (!id) continue;
    rows.push({
      entityType: 'SKILL', entityId: id, action: 'CREATE', actorId: dirId,
      payload: { name: skill.name, category: skill.category }, createdAt: days(-int(rng, 500, 800)),
    });
  }

  // --- USER ----------------------------------------------------------------
  for (const person of STAFF) {
    const user = staffOf(staff, person.key);
    rows.push({
      entityType: 'USER', entityId: user.id, action: 'CREATE', actorId: dirId,
      payload: { email: person.email, role: person.role }, createdAt: days(-int(rng, 400, 900)),
    });
    if (!person.isActive) {
      rows.push({
        entityType: 'USER', entityId: user.id, action: 'STATUS_CHANGE', actorId: dirId,
        payload: { isActive: { from: true, to: false }, reason: 'Depart de la societe' },
        createdAt: days(-int(rng, 30, 90)),
      });
    }
  }

  // --- CLIENT --------------------------------------------------------------
  for (const client of CLIENTS) {
    const id = input.clientIds.get(client.slug);
    if (!id) continue;
    rows.push({
      entityType: 'CLIENT', entityId: id, action: 'CREATE', actorId: pick(rng, mgrIds),
      payload: { name: client.name, industry: client.industry }, createdAt: days(-int(rng, 400, 900)),
    });
  }

  // --- CANDIDATE -----------------------------------------------------------
  for (const c of CANDIDATES) {
    const id = input.candidateIds.get(c.key);
    if (!id) continue;
    rows.push({
      entityType: 'CANDIDATE', entityId: id, action: 'CREATE', actorId: pick(rng, rhIds),
      payload: { source: c.source, targetPosition: c.targetPosition }, createdAt: days(-c.appliedDaysAgo),
    });
    if (c.status !== 'APPLIED') {
      rows.push({
        entityType: 'CANDIDATE', entityId: id, action: 'STATUS_CHANGE', actorId: pick(rng, rhIds),
        payload: { status: { from: 'APPLIED', to: c.status } },
        createdAt: days(-Math.max(1, Math.round(c.appliedDaysAgo / 2))),
      });
    }
    if (c.status === 'HIRED') {
      rows.push({
        entityType: 'CANDIDATE', entityId: id, action: 'CONVERT', actorId: pick(rng, rhIds),
        payload: { convertedTo: 'CONSULTANT', companyEmailGenerated: true },
        createdAt: days(-Math.max(1, Math.round(c.appliedDaysAgo / 3))),
      });
    }
  }

  // --- CONSULTANT ----------------------------------------------------------
  for (const consultant of input.consultants.values()) {
    rows.push({
      entityType: 'CONSULTANT', entityId: consultant.id, action: 'CREATE', actorId: pick(rng, rhIds),
      payload: { position: consultant.seed.position, seniority: consultant.seed.seniority },
      createdAt: consultant.hireDate,
    });
    if (consultant.seed.status !== 'AVAILABLE') {
      rows.push({
        entityType: 'CONSULTANT', entityId: consultant.id, action: 'STATUS_CHANGE', actorId: pick(rng, mgrIds),
        payload: { status: { from: 'AVAILABLE', to: consultant.seed.status } },
        createdAt: days(-int(rng, 20, 300)),
      });
    }
  }

  // --- MISSION + ASSIGNMENT ------------------------------------------------
  for (const mission of input.missions) {
    rows.push({
      entityType: 'MISSION', entityId: mission.id, action: 'CREATE', actorId: pick(rng, mgrIds),
      payload: { project: mission.project, tjm: mission.tjm.toFixed(2) },
      createdAt: days(mission.start - 30),
    });
    if (mission.status !== 'DRAFT') {
      rows.push({
        entityType: 'MISSION', entityId: mission.id, action: 'STATUS_CHANGE', actorId: pick(rng, mgrIds),
        payload: { status: { from: 'DRAFT', to: mission.status } },
        createdAt: days(mission.start - 5),
      });
    }
  }
  for (const assignment of input.assignments) {
    rows.push({
      entityType: 'ASSIGNMENT', entityId: assignment.id, action: 'CREATE', actorId: pick(rng, mgrIds),
      payload: { role: assignment.role, status: assignment.status }, createdAt: days(-int(rng, 10, 400)),
    });
  }

  // --- CONTRACT_TEMPLATE ---------------------------------------------------
  for (const [name, id] of Object.entries(input.templateIds)) {
    rows.push({
      entityType: 'CONTRACT_TEMPLATE', entityId: id, action: 'CREATE', actorId: dirId,
      payload: { template: name }, createdAt: days(-int(rng, 600, 800)),
    });
  }

  // --- CONTRACT: the full lifecycle ----------------------------------------
  for (const contract of input.contracts.values()) {
    const created = new Date(contract.start.getTime() - 30 * 86_400_000);
    rows.push({
      entityType: 'CONTRACT', entityId: contract.id, action: 'CREATE', actorId: pick(rng, rhIds),
      payload: { type: contract.type, consultantId: contract.consultantKey }, createdAt: created,
    });
    if (contract.status !== 'DRAFT') {
      rows.push({
        entityType: 'CONTRACT', entityId: contract.id, action: 'STATUS_CHANGE', actorId: pick(rng, rhIds),
        payload: { status: { from: 'DRAFT', to: 'INTERNAL_VALIDATION' }, step: 'SUBMIT' },
        createdAt: new Date(created.getTime() + 2 * 86_400_000),
      });
      rows.push({
        entityType: 'CONTRACT', entityId: contract.id, action: 'VALIDATE', actorId: pick(rng, mgrIds),
        payload: { step: 'MANAGER', decision: 'APPROVED' },
        createdAt: new Date(created.getTime() + 4 * 86_400_000),
      });
    }
    if (contract.status === 'SIGNED' || contract.status === 'ARCHIVED') {
      rows.push({
        entityType: 'CONTRACT', entityId: contract.id, action: 'SIGN', actorId: null,
        payload: { party: 'CONSULTANT', signatory: contract.consultantName }, createdAt: days(-1),
      });
      rows.push({
        entityType: 'CONTRACT', entityId: contract.id, action: 'COUNTERSIGN', actorId: pick(rng, rhIds),
        payload: { party: 'COMPANY', signatory: contract.companyName }, createdAt: days(-1),
      });
    }
    if (contract.status === 'ARCHIVED') {
      rows.push({
        entityType: 'CONTRACT', entityId: contract.id, action: 'STATUS_CHANGE', actorId: dirId,
        payload: { status: { from: 'SIGNED', to: 'ARCHIVED' } }, createdAt: days(-int(rng, 30, 200)),
      });
    }
  }
  // The rejection that sent ct19 back to DRAFT (see step-contracts.ts).
  const rejected = input.contracts.get('ct19');
  if (rejected) {
    rows.push({
      entityType: 'CONTRACT', entityId: rejected.id, action: 'STATUS_CHANGE', actorId: staffOf(staff, 'mgr1').id,
      payload: { status: { from: 'INTERNAL_VALIDATION', to: 'DRAFT' }, step: 'MANAGER', decision: 'REJECTED' },
      createdAt: days(-6),
    });
  }

  // --- JOB_POST ------------------------------------------------------------
  for (const post of JOB_POSTS) {
    const seeded = input.jobPosts.get(post.slug);
    if (!seeded) continue;
    const actor = staffOf(staff, post.author).id;
    rows.push({
      entityType: 'JOB_POST', entityId: seeded.id, action: 'CREATE', actorId: actor,
      payload: { title: post.title, employmentType: post.employmentType },
      createdAt: days(-(post.publishedDaysAgo ?? 10) - 7),
    });
    if (post.status === 'PUBLISHED' || post.status === 'CLOSED') {
      rows.push({
        entityType: 'JOB_POST', entityId: seeded.id, action: 'STATUS_CHANGE', actorId: actor,
        payload: { status: { from: 'DRAFT', to: 'PUBLISHED' } }, createdAt: days(-(post.publishedDaysAgo ?? 10)),
      });
    }
    if (post.status === 'CLOSED') {
      rows.push({
        entityType: 'JOB_POST', entityId: seeded.id, action: 'STATUS_CHANGE', actorId: actor,
        payload: { status: { from: 'PUBLISHED', to: 'CLOSED' } }, createdAt: days(-int(rng, 5, 40)),
      });
    }
  }

  // --- APPLICATION ---------------------------------------------------------
  for (const app of input.applications) {
    // Public submissions are anonymous: no actor.
    rows.push({
      entityType: 'APPLICATION', entityId: app.id, action: 'CREATE', actorId: null,
      payload: { channel: 'PUBLIC_PORTAL', jobPost: app.jobPostSlug }, createdAt: app.createdAt,
    });
    if (app.status === 'LINKED') {
      rows.push({
        entityType: 'APPLICATION', entityId: app.id, action: 'LINK', actorId: pick(rng, rhIds),
        payload: { linkedTo: 'CANDIDATE' }, createdAt: new Date(app.createdAt.getTime() + 2 * 86_400_000),
      });
    }
    if (app.status === 'REJECTED' || app.status === 'SPAM') {
      rows.push({
        entityType: 'APPLICATION', entityId: app.id, action: 'STATUS_CHANGE', actorId: pick(rng, rhIds),
        payload: { status: { from: 'SUBMITTED', to: app.status } },
        createdAt: new Date(app.createdAt.getTime() + 3 * 86_400_000),
      });
    }
  }

  // --- AI evaluations: read back what step-ai-evaluations just wrote --------
  const aiRuns = await prisma.aiEvaluation.findMany({
    select: { applicationId: true, score: true, verdict: true, cvUsed: true, model: true, createdById: true, createdAt: true },
  });
  for (const run of aiRuns) {
    rows.push({
      entityType: 'APPLICATION',
      entityId: run.applicationId,
      action: 'AI_EVALUATION_CREATED',
      actorId: run.createdById,
      payload: { score: run.score, verdict: run.verdict, cvUsed: run.cvUsed, model: run.model },
      createdAt: run.createdAt,
    });
  }

  await prisma.auditLog.createMany({ data: rows });
  return rows.length;
}
