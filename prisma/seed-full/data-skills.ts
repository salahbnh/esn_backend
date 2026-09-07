/**
 * The skills referential. Superset of `prisma/seed.ts` (those six are kept, same
 * names, so nothing that already references them breaks) grouped into the
 * categories the SkillPicker filters on.
 */
export interface SkillSeed {
  name: string;
  category: string;
}

export const SKILLS: readonly SkillSeed[] = [
  // Frontend
  { name: 'TypeScript', category: 'Frontend' },
  { name: 'React', category: 'Frontend' },
  { name: 'Next.js', category: 'Frontend' },
  { name: 'Angular', category: 'Frontend' },
  { name: 'Vue.js', category: 'Frontend' },
  { name: 'Tailwind CSS', category: 'Frontend' },
  // Backend
  { name: 'Node.js', category: 'Backend' },
  { name: 'Java / Spring Boot', category: 'Backend' },
  { name: '.NET Core', category: 'Backend' },
  { name: 'Python', category: 'Backend' },
  { name: 'PHP / Symfony', category: 'Backend' },
  { name: 'Go', category: 'Backend' },
  { name: 'API REST', category: 'Backend' },
  { name: 'GraphQL', category: 'Backend' },
  // Database
  { name: 'PostgreSQL', category: 'Database' },
  { name: 'MySQL', category: 'Database' },
  { name: 'MongoDB', category: 'Database' },
  { name: 'Oracle DB', category: 'Database' },
  { name: 'Redis', category: 'Database' },
  // Cloud & DevOps
  { name: 'AWS', category: 'Cloud' },
  { name: 'Azure', category: 'Cloud' },
  { name: 'Google Cloud', category: 'Cloud' },
  { name: 'Docker', category: 'DevOps' },
  { name: 'Kubernetes', category: 'DevOps' },
  { name: 'Terraform', category: 'DevOps' },
  { name: 'CI/CD (GitLab)', category: 'DevOps' },
  // Data
  { name: 'SQL / Analytics', category: 'Data' },
  { name: 'Apache Spark', category: 'Data' },
  { name: 'Power BI', category: 'Data' },
  { name: 'Machine Learning', category: 'Data' },
  // Mobile
  { name: 'Flutter', category: 'Mobile' },
  { name: 'React Native', category: 'Mobile' },
  { name: 'Swift / iOS', category: 'Mobile' },
  // Sécurité & QA
  { name: 'Cybersecurite', category: 'Securite' },
  { name: 'Tests automatises', category: 'QA' },
  { name: 'Cypress / Playwright', category: 'QA' },
  // Métier / transverse
  { name: 'SAP', category: 'ERP' },
  { name: 'Agile / Scrum', category: 'Methodologie' },
  { name: 'Project Management', category: 'Soft Skills' },
  { name: 'Communication client', category: 'Soft Skills' },
  { name: 'Anglais professionnel', category: 'Langues' },
  { name: 'Francais professionnel', category: 'Langues' },
];

/** Skill names grouped by the consultant profile they typically belong to. */
export const SKILL_PROFILES: Record<string, readonly string[]> = {
  fullstack: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'API REST'],
  backend: ['Java / Spring Boot', 'PostgreSQL', 'API REST', 'Docker', 'Redis'],
  frontend: ['TypeScript', 'React', 'Next.js', 'Tailwind CSS', 'Cypress / Playwright'],
  devops: ['Docker', 'Kubernetes', 'Terraform', 'AWS', 'CI/CD (GitLab)'],
  data: ['Python', 'SQL / Analytics', 'Apache Spark', 'Power BI', 'Machine Learning'],
  mobile: ['Flutter', 'React Native', 'Swift / iOS', 'API REST'],
  security: ['Cybersecurite', 'Docker', 'Anglais professionnel'],
  qa: ['Tests automatises', 'Cypress / Playwright', 'Agile / Scrum'],
  erp: ['SAP', 'SQL / Analytics', 'Communication client'],
  management: ['Agile / Scrum', 'Project Management', 'Communication client', 'Anglais professionnel'],
};
