import { PrismaClient, Role } from '@prisma/client';

/**
 * DEV-ONLY demo dataset for populating the dashboards/reports during frontend
 * development. Idempotent: uses fixed cuid-valid ids + upsert. Does NOT touch
 * the reference seed (prisma/seed.ts). Run: `npm run seed:demo`.
 *
 * Ids must satisfy the API's `z.string().cuid()` path-param validation
 * (`/^c[^\s-]{8,}$/i`) — i.e. start with `c` and contain no hyphens/spaces — so
 * that demo records behave exactly like real (API-created, cuid-keyed) ones on
 * the `/:id` detail routes. `demoId('demo-cand-7') → 'cdemocand7'`.
 */
const prisma = new PrismaClient();

const day = 24 * 60 * 60 * 1000;
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * day);
}

/** Readable slug → cuid-valid id (see file header). */
function demoId(slug: string): string {
  return `c${slug.replace(/-/g, '')}`;
}

/**
 * One-time cleanup of rows created under the previous readable-id scheme
 * (`demo-*`, which failed `.cuid()` route validation). Deleted in FK-safe order.
 * After the switch, ids start with `c…`, so this matches nothing on later runs.
 */
async function purgeLegacyDemoRows(): Promise<void> {
  await prisma.assignment.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.contract.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.candidate.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.mission.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.consultant.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.client.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'demo-user-' } } });
}

async function main(): Promise<void> {
  await purgeLegacyDemoRows();

  // Skills referential (seeded by prisma/seed.ts) → connect helper by name.
  const allSkills = await prisma.skill.findMany({ select: { id: true, name: true } });
  const connectSkillsByName = (names: string[]) =>
    names
      .map((n) => allSkills.find((sk) => sk.name === n)?.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));

  // --- Clients ---
  const clients = [
    { id: 'demo-client-bnp', name: 'BNP Paribas', industry: 'Banque' },
    { id: 'demo-client-airbus', name: 'Airbus', industry: 'Aéronautique' },
    { id: 'demo-client-edf', name: 'EDF', industry: 'Énergie' },
  ];
  for (const c of clients) {
    const id = demoId(c.id);
    await prisma.client.upsert({
      where: { id },
      update: {},
      create: { id, name: c.name, industry: c.industry },
    });
  }

  // --- Consultants (each needs a User). Statuses spread for occupancy/HR KPIs. ---
  const consultantSpec = [
    { key: 'sara', first: 'Sara', last: 'Benali', position: 'Dev Full-Stack', tjm: '650.00', status: 'ON_MISSION' as const, skills: ['React', 'Node.js', 'TypeScript'] },
    { key: 'karim', first: 'Karim', last: 'Haddad', position: 'Data Engineer', tjm: '700.00', status: 'ON_MISSION' as const, skills: ['PostgreSQL', 'Node.js'] },
    { key: 'lea', first: 'Léa', last: 'Moreau', position: 'DevOps', tjm: '720.00', status: 'ON_MISSION' as const, skills: ['AWS', 'Node.js'] },
    { key: 'tom', first: 'Tom', last: 'Girard', position: 'Dev Backend', tjm: '600.00', status: 'INTERCONTRAT' as const, skills: ['Node.js', 'PostgreSQL'] },
    { key: 'nina', first: 'Nina', last: 'Lopez', position: 'UX Designer', tjm: '580.00', status: 'INTERCONTRAT' as const, skills: ['React'] },
    { key: 'omar', first: 'Omar', last: 'Cherif', position: 'Architecte', tjm: '850.00', status: 'AVAILABLE' as const, skills: ['React', 'Node.js', 'TypeScript', 'AWS'] },
    { key: 'eva', first: 'Eva', last: 'Petit', position: 'QA Engineer', tjm: '560.00', status: 'AVAILABLE' as const, skills: ['TypeScript', 'React'] },
  ];
  const consultantIds: Record<string, string> = {};
  for (const c of consultantSpec) {
    const userId = demoId(`demo-user-${c.key}`);
    const consultantId = demoId(`demo-cons-${c.key}`);
    await prisma.user.upsert({
      where: { id: userId },
      update: { role: Role.CONSULTANT },
      create: {
        id: userId,
        keycloakId: `demo-kc-${c.key}`,
        email: `${c.key}@demo.esn.local`,
        firstName: c.first,
        lastName: c.last,
        role: Role.CONSULTANT,
      },
    });
    await prisma.consultant.upsert({
      where: { id: consultantId },
      update: {
        status: c.status, tjm: c.tjm, position: c.position,
        skills: { set: connectSkillsByName(c.skills) },
      },
      create: {
        id: consultantId,
        userId,
        position: c.position,
        tjm: c.tjm,
        status: c.status,
        hireDate: daysFromNow(-200),
        skills: { connect: connectSkillsByName(c.skills) },
      },
    });
    consultantIds[c.key] = consultantId;
  }

  // --- Candidates across the pipeline (for the funnel) ---
  const candidates = [
    { id: 'demo-cand-1', status: 'APPLIED' as const, first: 'Hugo', last: 'Martin' },
    { id: 'demo-cand-2', status: 'APPLIED' as const, first: 'Jade', last: 'Roux' },
    { id: 'demo-cand-3', status: 'APPLIED' as const, first: 'Lucas', last: 'Blanc' },
    { id: 'demo-cand-4', status: 'INTERVIEW' as const, first: 'Manon', last: 'Faure' },
    { id: 'demo-cand-5', status: 'INTERVIEW' as const, first: 'Noah', last: 'Garnier' },
    { id: 'demo-cand-6', status: 'VALIDATED' as const, first: 'Inès', last: 'Chevalier' },
    { id: 'demo-cand-7', status: 'REJECTED' as const, first: 'Adam', last: 'Renaud' },
  ];
  for (const c of candidates) {
    const id = demoId(c.id);
    await prisma.candidate.upsert({
      where: { id },
      update: { status: c.status },
      create: {
        id,
        firstName: c.first,
        lastName: c.last,
        email: `${c.id}@demo.esn.local`,
        status: c.status,
        source: 'LinkedIn',
        targetPosition: 'Consultant·e',
      },
    });
  }

  // --- Missions across statuses (CLOSED ones carry end dates → avg duration) ---
  const missions = [
    { id: 'demo-mis-1', clientId: 'demo-client-bnp', project: 'Plateforme paiements', role: 'Dev Full-Stack', tjm: '650.00', status: 'IN_PROGRESS' as const, start: -60, end: null, skills: ['React', 'Node.js'] },
    { id: 'demo-mis-2', clientId: 'demo-client-airbus', project: 'Pipeline données', role: 'Data Engineer', tjm: '700.00', status: 'IN_PROGRESS' as const, start: -30, end: null, skills: ['PostgreSQL', 'Node.js'] },
    { id: 'demo-mis-3', clientId: 'demo-client-edf', project: 'Migration cloud', role: 'DevOps', tjm: '720.00', status: 'STAFFED' as const, start: 10, end: null, skills: ['AWS', 'Node.js'] },
    { id: 'demo-mis-4', clientId: 'demo-client-bnp', project: 'Refonte mobile', role: 'Dev Full-Stack', tjm: '640.00', status: 'DRAFT' as const, start: 30, end: null, skills: ['React', 'TypeScript', 'Node.js'] },
    { id: 'demo-mis-5', clientId: 'demo-client-airbus', project: 'Audit sécurité', role: 'Sécurité', tjm: '800.00', status: 'CLOSED' as const, start: -180, end: -90, skills: ['AWS'] },
    { id: 'demo-mis-6', clientId: 'demo-client-edf', project: 'Portail RH', role: 'Dev Full-Stack', tjm: '620.00', status: 'CLOSED' as const, start: -240, end: -120, skills: ['React'] },
  ];
  for (const m of missions) {
    const id = demoId(m.id);
    await prisma.mission.upsert({
      where: { id },
      update: { status: m.status, requiredSkills: { set: connectSkillsByName(m.skills) } },
      create: {
        id,
        clientId: demoId(m.clientId),
        project: m.project,
        role: m.role,
        tjm: m.tjm,
        status: m.status,
        startDate: daysFromNow(m.start),
        endDate: m.end !== null ? daysFromNow(m.end) : null,
        requiredSkills: { connect: connectSkillsByName(m.skills) },
      },
    });
  }

  // --- ACTIVE assignments (drive occupancy). 3 consultants on missions. ---
  const assignments = [
    { id: 'demo-asg-1', missionId: 'demo-mis-1', cons: 'sara', alloc: 100 },
    { id: 'demo-asg-2', missionId: 'demo-mis-2', cons: 'karim', alloc: 80 },
    { id: 'demo-asg-3', missionId: 'demo-mis-1', cons: 'lea', alloc: 50 },
  ];
  for (const a of assignments) {
    const id = demoId(a.id);
    await prisma.assignment.upsert({
      where: { id },
      update: { status: 'ACTIVE', allocationPct: a.alloc },
      create: {
        id,
        missionId: demoId(a.missionId),
        consultantId: consultantIds[a.cons]!,
        allocationPct: a.alloc,
        status: 'ACTIVE',
        startDate: daysFromNow(-30),
      },
    });
  }

  // --- A couple of contracts across statuses (HR report) ---
  // Contracts past DRAFT also get their ContractValidation circuit rows, exactly
  // as a real `PATCH /:id/submit` would have created them — otherwise the
  // "Circuit de validation" timeline (rightly) reports no circuit.
  const contracts = [
    { id: 'demo-ctr-1', cons: 'sara', type: 'CDI', status: 'SIGNED' as const },
    { id: 'demo-ctr-2', cons: 'tom', type: 'CDI', status: 'INTERNAL_VALIDATION' as const },
    { id: 'demo-ctr-3', cons: 'karim', type: 'CDD', status: 'DRAFT' as const },
  ];
  const rhUser = await prisma.user.findUnique({ where: { email: 'rh@esn.local' } });
  const mgrUser = await prisma.user.findUnique({ where: { email: 'manager@esn.local' } });
  const dirUser = await prisma.user.findUnique({ where: { email: 'direction@esn.local' } });
  for (const c of contracts) {
    const id = demoId(c.id);
    // SIGNED demo contract carries realistic two-party signature stamps.
    const signedStamps =
      c.status === 'SIGNED'
        ? {
            consultantSignedAt: daysFromNow(-12),
            consultantSignatoryName: 'Sara Benali',
            companySignedAt: daysFromNow(-10),
            companySignatoryName: 'Rachida Haddaoui',
          }
        : {};
    await prisma.contract.upsert({
      where: { id },
      update: { status: c.status, managerId: mgrUser?.id ?? null, ...signedStamps },
      create: {
        id,
        consultantId: consultantIds[c.cons]!,
        type: c.type,
        status: c.status,
        managerId: mgrUser?.id ?? null,
        prefilledData: { fields: {}, renderedBody: '', unfilled: [] },
        ...signedStamps,
      },
    });

    // Validation circuit rows (idempotent: wipe + recreate for this contract).
    await prisma.contractValidation.deleteMany({ where: { contractId: id } });
    if (c.status === 'SIGNED') {
      // Fully approved circuit.
      await prisma.contractValidation.createMany({
        data: [
          { contractId: id, step: 'RH', state: 'APPROVED', validatorId: rhUser?.id ?? null, decidedAt: daysFromNow(-16), comment: 'Dossier complet.' },
          { contractId: id, step: 'MANAGER', state: 'APPROVED', validatorId: mgrUser?.id ?? null, decidedAt: daysFromNow(-15) },
          { contractId: id, step: 'DIRECTION', state: 'APPROVED', validatorId: dirUser?.id ?? null, decidedAt: daysFromNow(-14) },
        ],
      });
    } else if (c.status === 'INTERNAL_VALIDATION') {
      // Mid-circuit: RH approved, MANAGER pending, DIRECTION untouched.
      await prisma.contractValidation.createMany({
        data: [
          { contractId: id, step: 'RH', state: 'APPROVED', validatorId: rhUser?.id ?? null, decidedAt: daysFromNow(-2), comment: 'OK côté RH.' },
          { contractId: id, step: 'MANAGER', state: 'PENDING' },
          { contractId: id, step: 'DIRECTION', state: 'PENDING' },
        ],
      });
    }
    // DRAFT: no rows — the circuit genuinely has not started.
  }

  // --- Link the seeded LOGIN consultant (consultant@esn.local) to a profile +
  //     an active mission, so their /reports/me dashboard shows real data. ---
  const loginUser = await prisma.user.findUnique({ where: { email: 'consultant@esn.local' } });
  if (loginUser) {
    await prisma.consultant.upsert({
      where: { userId: loginUser.id },
      update: { status: 'ON_MISSION' },
      create: {
        id: demoId('demo-cons-login'),
        userId: loginUser.id,
        position: 'Dev Full-Stack',
        tjm: '640.00',
        status: 'ON_MISSION',
        hireDate: daysFromNow(-150),
      },
    });
    const lc = await prisma.consultant.findUnique({
      where: { userId: loginUser.id },
      select: { id: true },
    });
    if (lc) {
      await prisma.assignment.upsert({
        where: { id: demoId('demo-asg-login') },
        update: { status: 'ACTIVE', allocationPct: 80 },
        create: {
          id: demoId('demo-asg-login'),
          missionId: demoId('demo-mis-2'),
          consultantId: lc.id,
          allocationPct: 80,
          status: 'ACTIVE',
          startDate: daysFromNow(-20),
        },
      });
    }
  }

  // --- Job posts (offres d'emploi) + questions + applications ---
  const rhAuthor = await prisma.user.findUnique({ where: { email: 'rh@esn.local' } });

  const jobPostSpecs = [
    {
      id: 'demo-job-fullstack',
      title: 'Développeur Full-Stack React / Node.js',
      description:
        "Au sein de nos équipes, vous concevez et développez des applications web modernes pour nos clients grands comptes, de la conception jusqu'à la mise en production. Vous participez aux choix techniques et à la revue de code.",
      requirements:
        "Maîtrise de React et de Node.js, bonnes pratiques de tests, autonomie et esprit d'équipe. Une expérience en TypeScript est un plus.",
      location: 'Paris',
      employmentType: 'CDI' as const,
      seniorityLevel: 'CONFIRMED' as const,
      minYearsExperience: 3,
      status: 'PUBLISHED' as const,
      publicToken: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      publishedDaysAgo: 12,
      skills: ['React', 'Node.js', 'TypeScript'],
    },
    {
      id: 'demo-job-devops',
      title: 'Ingénieur DevOps / Cloud AWS',
      description:
        "Vous industrialisez le déploiement et l'exploitation de nos applications sur le cloud AWS : intégration continue, conteneurisation, supervision et sécurité.",
      requirements: 'Solide expérience AWS, conteneurs et automatisation. Astreintes ponctuelles.',
      location: 'Lyon',
      employmentType: 'CDI' as const,
      seniorityLevel: 'SENIOR' as const,
      minYearsExperience: 5,
      status: 'PUBLISHED' as const,
      publicToken: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7',
      publishedDaysAgo: 6,
      skills: ['AWS', 'Node.js'],
    },
    {
      id: 'demo-job-chefprojet',
      title: 'Chef de projet technique',
      description:
        "Vous pilotez des projets de développement pour nos clients : cadrage, planification, coordination des équipes et suivi de la qualité.",
      requirements: "Expérience confirmée en gestion de projet et culture technique solide.",
      location: 'Paris',
      employmentType: 'CDI' as const,
      seniorityLevel: 'LEAD' as const,
      minYearsExperience: 7,
      status: 'PUBLISHED' as const,
      publicToken: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
      publishedDaysAgo: 3,
      skills: ['Project Management'],
    },
    {
      id: 'demo-job-data',
      title: 'Consultant Data / PostgreSQL',
      description:
        "Vous accompagnez nos clients sur leurs projets de données : modélisation, optimisation de bases PostgreSQL et valorisation de la donnée.",
      requirements: 'Bonne maîtrise de SQL et de PostgreSQL.',
      location: 'Nantes',
      employmentType: 'CDI' as const,
      seniorityLevel: 'CONFIRMED' as const,
      minYearsExperience: 3,
      status: 'DRAFT' as const,
      publicToken: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f809',
      publishedDaysAgo: 0,
      skills: ['PostgreSQL'],
    },
    {
      id: 'demo-job-stage',
      title: 'Stage Développement Web',
      description:
        "Stage de fin d'études au sein d'une équipe produit : participation au développement d'une application web sous la responsabilité d'un tuteur.",
      requirements: 'Étudiant(e) en informatique, bases en développement web.',
      location: 'Paris',
      employmentType: 'STAGE' as const,
      seniorityLevel: 'JUNIOR' as const,
      minYearsExperience: 0,
      status: 'CLOSED' as const,
      publicToken: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f80912',
      publishedDaysAgo: 40,
      skills: ['React'],
    },
  ];

  if (rhAuthor) {
    for (const jp of jobPostSpecs) {
      const id = demoId(jp.id);
      await prisma.jobPost.upsert({
        where: { id },
        update: { status: jp.status },
        create: {
          id,
          title: jp.title,
          description: jp.description,
          requirements: jp.requirements,
          location: jp.location,
          employmentType: jp.employmentType,
          seniorityLevel: jp.seniorityLevel,
          minYearsExperience: jp.minYearsExperience,
          status: jp.status,
          publicToken: jp.publicToken,
          publishedAt: jp.status === 'PUBLISHED' ? daysFromNow(-jp.publishedDaysAgo) : null,
          authorId: rhAuthor.id,
          requiredSkills: { connect: connectSkillsByName(jp.skills) },
        },
      });
    }

    // Questions on the flagship published post (drive the public form + answers).
    const fullstackId = demoId('demo-job-fullstack');
    const questions = [
      { key: 'motivation', label: 'Pourquoi souhaitez-vous nous rejoindre ?', type: 'LONG_TEXT' as const, required: true, order: 0 },
      { key: 'disponibilite', label: 'Quelle est votre disponibilité ?', type: 'SHORT_TEXT' as const, required: true, order: 1 },
      { key: 'teletravail', label: 'Acceptez-vous le télétravail partiel ?', type: 'BOOLEAN' as const, required: false, order: 2 },
    ];
    for (const q of questions) {
      await prisma.jobQuestion.upsert({
        where: { jobPostId_key: { jobPostId: fullstackId, key: q.key } },
        update: { label: q.label },
        create: { id: demoId(`demo-jq-${q.key}`), jobPostId: fullstackId, ...q },
      });
    }

    // A few applications on the flagship post.
    const applications = [
      {
        id: 'demo-app-1', firstName: 'Karim', lastName: 'Benali', email: 'karim.benali@example.com',
        phone: '0612345678', status: 'SUBMITTED' as const,
        motivation: "Votre positionnement sur les projets grands comptes correspond exactement à ce que je recherche pour progresser.",
        dispo: 'Sous un mois', teletravail: true, skills: ['React', 'Node.js'],
      },
      {
        id: 'demo-app-2', firstName: 'Léa', lastName: 'Dubois', email: 'lea.dubois@example.com',
        phone: '0623456789', status: 'UNDER_REVIEW' as const,
        motivation: "Je souhaite rejoindre une équipe qui valorise la qualité du code et le travail collaboratif.",
        dispo: 'Immédiate', teletravail: false, skills: ['React', 'TypeScript'],
      },
      {
        id: 'demo-app-3', firstName: 'Marc', lastName: 'Petit', email: 'marc.petit@example.com',
        phone: '0634567890', status: 'SUBMITTED' as const,
        motivation: "Fort de plusieurs projets en Node.js, je veux relever de nouveaux défis techniques chez vous.",
        dispo: 'Sous deux mois', teletravail: true, skills: ['Node.js', 'PostgreSQL'],
      },
    ];
    for (const a of applications) {
      await prisma.application.upsert({
        where: { id: demoId(a.id) },
        update: { status: a.status },
        create: {
          id: demoId(a.id),
          jobPostId: fullstackId,
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          phone: a.phone,
          consentAcceptedAt: daysFromNow(-2),
          jobTitleSnapshot: 'Développeur Full-Stack React / Node.js',
          status: a.status,
          answers: [
            { key: 'motivation', label: 'Pourquoi souhaitez-vous nous rejoindre ?', type: 'LONG_TEXT', value: a.motivation },
            { key: 'disponibilite', label: 'Quelle est votre disponibilité ?', type: 'SHORT_TEXT', value: a.dispo },
            { key: 'teletravail', label: 'Acceptez-vous le télétravail partiel ?', type: 'BOOLEAN', value: a.teletravail },
          ],
          declaredSkills: a.skills.map((name) => ({ name })),
        },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    'Demo seed done: %d clients, %d consultants, %d candidates, %d missions, %d assignments, %d contracts, %d job posts (+ login consultant linked).',
    clients.length, consultantSpec.length, candidates.length, missions.length, assignments.length, contracts.length, jobPostSpecs.length,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
