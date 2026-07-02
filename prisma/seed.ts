import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent dev seed: referential skills, one contract template, and one
 * dev User per role. keycloakId values are placeholders — replace them with
 * the real Keycloak `sub` once the realm is provisioned.
 */
async function main(): Promise<void> {
  // --- Referential skills ---
  const skills = [
    { name: 'TypeScript', category: 'Frontend' },
    { name: 'Node.js', category: 'Backend' },
    { name: 'React', category: 'Frontend' },
    { name: 'PostgreSQL', category: 'Database' },
    { name: 'AWS', category: 'Cloud' },
    { name: 'Project Management', category: 'Soft Skills' },
  ];

  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { name: skill.name },
      update: { category: skill.category },
      create: skill,
    });
  }

  // --- Contract templates (one per contract type) ---
  // Placeholders auto-filled from the consultant/contract: firstName, lastName,
  // position, tjm, startDate, endDate, type. Any other {{token}} is a MANUAL
  // field RH completes before the PDF can be generated.
  const contractTemplates = [
    {
      name: 'CDI standard',
      body: [
        'CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE',
        '',
        "Entre la société ESN, ci-après « l'Employeur »,",
        'et {{firstName}} {{lastName}}, ci-après « le Salarié »,',
        'engagé(e) au poste de {{position}} à compter du {{startDate}}.',
        '',
        'Type de contrat : {{type}}.',
        'Lieu de travail : {{lieuTravail}}.',
        'Rémunération annuelle brute : {{remunerationAnnuelle}} €.',
        'Taux journalier de référence (TJM) : {{tjm}} €.',
        "Période d'essai : {{periodeEssai}}.",
        '',
        'Fait à Paris, le {{startDate}}.',
        "Signatures : l'Employeur — le Salarié.",
      ].join('\n'),
    },
    {
      name: 'CDD standard',
      body: [
        'CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE',
        '',
        'Entre la société ESN et {{firstName}} {{lastName}},',
        'au poste de {{position}}, du {{startDate}} au {{endDate}}.',
        '',
        'Type de contrat : {{type}}.',
        'Motif de recours : {{motifRecours}}.',
        'Rémunération annuelle brute : {{remunerationAnnuelle}} €.',
        'Taux journalier de référence (TJM) : {{tjm}} €.',
        '',
        'Fait à Paris, le {{startDate}}.',
      ].join('\n'),
    },
    {
      name: 'Contrat de prestation (Régie)',
      body: [
        'CONTRAT DE PRESTATION DE SERVICES (RÉGIE)',
        '',
        'Entre la société ESN et {{firstName}} {{lastName}},',
        'consultant(e) au poste de {{position}}, pour une mission',
        'débutant le {{startDate}} et se terminant le {{endDate}}.',
        '',
        'Type de contrat : {{type}}.',
        'Client final : {{nomClient}}.',
        'Taux journalier facturé (TJM) : {{tjm}} €.',
        '',
        'Fait à Paris, le {{startDate}}.',
      ].join('\n'),
    },
  ];

  // One-time cleanup: earlier seeds used non-cuid ids (`tmpl-*-default`) that the
  // contract create schema (`templateId` must be a cuid) rejects. Drop those so
  // we re-create them with real cuids below. No contract references them.
  await prisma.contractTemplate.deleteMany({
    where: { id: { in: ['tmpl-cdi-default', 'tmpl-cdd-default', 'tmpl-regie-default'] } },
  });

  // Idempotent on `name` (no fixed id → Prisma generates a cuid).
  for (const tmpl of contractTemplates) {
    const existing = await prisma.contractTemplate.findFirst({ where: { name: tmpl.name } });
    if (existing) {
      await prisma.contractTemplate.update({
        where: { id: existing.id },
        data: { body: tmpl.body, isActive: true },
      });
    } else {
      await prisma.contractTemplate.create({ data: { ...tmpl, isActive: true } });
    }
  }

  // --- Dev users: one per role ---
  const devUsers: Array<{
    keycloakId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
  }> = [
    // keycloakId values MUST match the fixed user ids in keycloak/realm-export.json
    // so a dev login's token `sub` maps to the seeded User row.
    {
      keycloakId: '11111111-1111-1111-1111-111111111111',
      email: 'rh@esn.local',
      firstName: 'Rita',
      lastName: 'RH',
      role: Role.RH,
    },
    {
      keycloakId: '22222222-2222-2222-2222-222222222222',
      email: 'manager@esn.local',
      firstName: 'Marc',
      lastName: 'Manager',
      role: Role.MANAGER,
    },
    {
      keycloakId: '33333333-3333-3333-3333-333333333333',
      email: 'direction@esn.local',
      firstName: 'Diana',
      lastName: 'Direction',
      role: Role.DIRECTION,
    },
    {
      keycloakId: '44444444-4444-4444-4444-444444444444',
      email: 'consultant@esn.local',
      firstName: 'Carl',
      lastName: 'Consultant',
      role: Role.CONSULTANT,
    },
  ];

  for (const user of devUsers) {
    await prisma.user.upsert({
      where: { keycloakId: user.keycloakId },
      update: { email: user.email, role: user.role },
      create: user,
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    'Seed complete: %d skills, %d templates, %d users.',
    skills.length,
    contractTemplates.length,
    devUsers.length,
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
