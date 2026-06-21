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
    { key: 'sara', first: 'Sara', last: 'Benali', position: 'Dev Full-Stack', tjm: '650.00', status: 'ON_MISSION' as const },
    { key: 'karim', first: 'Karim', last: 'Haddad', position: 'Data Engineer', tjm: '700.00', status: 'ON_MISSION' as const },
    { key: 'lea', first: 'Léa', last: 'Moreau', position: 'DevOps', tjm: '720.00', status: 'ON_MISSION' as const },
    { key: 'tom', first: 'Tom', last: 'Girard', position: 'Dev Backend', tjm: '600.00', status: 'INTERCONTRAT' as const },
    { key: 'nina', first: 'Nina', last: 'Lopez', position: 'UX Designer', tjm: '580.00', status: 'INTERCONTRAT' as const },
    { key: 'omar', first: 'Omar', last: 'Cherif', position: 'Architecte', tjm: '850.00', status: 'AVAILABLE' as const },
    { key: 'eva', first: 'Eva', last: 'Petit', position: 'QA Engineer', tjm: '560.00', status: 'AVAILABLE' as const },
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
      update: { status: c.status, tjm: c.tjm, position: c.position },
      create: {
        id: consultantId,
        userId,
        position: c.position,
        tjm: c.tjm,
        status: c.status,
        hireDate: daysFromNow(-200),
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
    { id: 'demo-mis-1', clientId: 'demo-client-bnp', project: 'Plateforme paiements', role: 'Dev Full-Stack', tjm: '650.00', status: 'IN_PROGRESS' as const, start: -60, end: null },
    { id: 'demo-mis-2', clientId: 'demo-client-airbus', project: 'Pipeline données', role: 'Data Engineer', tjm: '700.00', status: 'IN_PROGRESS' as const, start: -30, end: null },
    { id: 'demo-mis-3', clientId: 'demo-client-edf', project: 'Migration cloud', role: 'DevOps', tjm: '720.00', status: 'STAFFED' as const, start: 10, end: null },
    { id: 'demo-mis-4', clientId: 'demo-client-bnp', project: 'Refonte mobile', role: 'Dev Mobile', tjm: '640.00', status: 'DRAFT' as const, start: 30, end: null },
    { id: 'demo-mis-5', clientId: 'demo-client-airbus', project: 'Audit sécurité', role: 'Sécurité', tjm: '800.00', status: 'CLOSED' as const, start: -180, end: -90 },
    { id: 'demo-mis-6', clientId: 'demo-client-edf', project: 'Portail RH', role: 'Dev Full-Stack', tjm: '620.00', status: 'CLOSED' as const, start: -240, end: -120 },
  ];
  for (const m of missions) {
    const id = demoId(m.id);
    await prisma.mission.upsert({
      where: { id },
      update: { status: m.status },
      create: {
        id,
        clientId: demoId(m.clientId),
        project: m.project,
        role: m.role,
        tjm: m.tjm,
        status: m.status,
        startDate: daysFromNow(m.start),
        endDate: m.end !== null ? daysFromNow(m.end) : null,
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
  const contracts = [
    { id: 'demo-ctr-1', cons: 'sara', type: 'CDI', status: 'SIGNED' as const },
    { id: 'demo-ctr-2', cons: 'tom', type: 'CDI', status: 'INTERNAL_VALIDATION' as const },
    { id: 'demo-ctr-3', cons: 'karim', type: 'CDD', status: 'DRAFT' as const },
  ];
  for (const c of contracts) {
    const id = demoId(c.id);
    await prisma.contract.upsert({
      where: { id },
      update: { status: c.status },
      create: {
        id,
        consultantId: consultantIds[c.cons]!,
        type: c.type,
        status: c.status,
        prefilledData: { fields: {}, renderedBody: '', unfilled: [] },
      },
    });
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

  // eslint-disable-next-line no-console
  console.log(
    'Demo seed done: %d clients, %d consultants, %d candidates, %d missions, %d assignments, %d contracts (+ login consultant linked).',
    clients.length, consultantSpec.length, candidates.length, missions.length, assignments.length, contracts.length,
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
