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

  // --- Contract template ---
  await prisma.contractTemplate.upsert({
    where: { id: 'tmpl-cdi-default' },
    update: {},
    create: {
      id: 'tmpl-cdi-default',
      name: 'CDI standard',
      body: [
        'CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE',
        '',
        'Entre la société ESN et {{firstName}} {{lastName}},',
        'au poste de {{position}}, à compter du {{startDate}}.',
        'Rémunération de référence (TJM): {{tjm}}.',
      ].join('\n'),
      isActive: true,
    },
  });

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
  console.log('Seed complete: %d skills, 1 template, %d users.', skills.length, devUsers.length);
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
