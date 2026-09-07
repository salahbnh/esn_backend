/**
 * Job offers published on the public portal, with their custom questions.
 *
 * Covers every `JobPostStatus`, every `EmploymentType`, every `SeniorityLevel`
 * (plus one post that leaves it null), and every `QuestionType`. One question is
 * archived to exercise the soft-delete path — answers already submitted stay
 * readable because `Application.answers` is a frozen snapshot.
 */
import type { EmploymentType, JobPostStatus, QuestionType, SeniorityLevel } from '@prisma/client';
import type { SKILL_PROFILES } from './data-skills.js';

export interface QuestionSeed {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  config?: Record<string, number>;
  helpText?: string;
  archived?: boolean;
}

export interface JobPostSeed {
  slug: string;
  title: string;
  description: string;
  requirements: string;
  location: string;
  employmentType: EmploymentType;
  seniorityLevel: SeniorityLevel | null;
  minYearsExperience: number | null;
  status: JobPostStatus;
  profile: keyof typeof SKILL_PROFILES;
  /** Author staff key (see STAFF in step-users.ts). */
  author: string;
  publishedDaysAgo: number | null;
  expiresInDays: number | null;
  questions: QuestionSeed[];
}

const CONSENT_HELP = 'Vos donnees sont conservees 24 mois puis supprimees.';

export const JOB_POSTS: readonly JobPostSeed[] = [
  {
    slug: 'fullstack-tunis',
    title: 'Developpeur Full-Stack (TypeScript / React / Node)',
    description:
      "Vous rejoignez nos equipes de developpement pour intervenir chez nos clients grands comptes (banque, assurance, telecom) sur des plateformes web a fort trafic. Vous participez a la conception, au developpement et a la mise en production, en methodologie agile.",
    requirements:
      "Diplome d'ingenieur en informatique ou equivalent. Maitrise de TypeScript, React et Node.js. Bonne connaissance des bases relationnelles. Francais courant, anglais technique.",
    location: 'Tunis — Lac 2 (hybride)',
    employmentType: 'CDI',
    seniorityLevel: 'CONFIRMED',
    minYearsExperience: 3,
    status: 'PUBLISHED',
    profile: 'fullstack',
    author: 'rh1',
    publishedDaysAgo: 40,
    expiresInDays: 50,
    questions: [
      { key: 'annees_exp', label: "Combien d'annees d'experience avez-vous en developpement web ?", type: 'NUMBER', required: true, config: { min: 0, max: 40 } },
      { key: 'stack', label: 'Quelle stack maitrisez-vous le mieux ?', type: 'SINGLE_CHOICE', required: true, options: ['React / Node', 'Angular / .NET', 'Vue / PHP', 'Autre'] },
      { key: 'dispo', label: 'Quelle est votre disponibilite ?', type: 'SHORT_TEXT', required: true, helpText: 'Ex. immediate, sous 1 mois, sous 3 mois.' },
      { key: 'motivation', label: 'Pourquoi souhaitez-vous nous rejoindre ?', type: 'LONG_TEXT', required: false, config: { maxLength: 1500 } },
      { key: 'mobilite', label: 'Acceptez-vous des deplacements ponctuels chez le client ?', type: 'BOOLEAN', required: true, helpText: CONSENT_HELP },
    ],
  },
  {
    slug: 'frontend-react',
    title: 'Developpeur Frontend React',
    description:
      "Au sein d'une equipe produit, vous construisez des interfaces accessibles et performantes pour un portail utilise quotidiennement par plusieurs milliers d'utilisateurs.",
    requirements: 'React, TypeScript, CSS moderne. Sensibilite UX et accessibilite. Tests automatises apprecies.',
    location: 'Tunis — Centre Urbain Nord',
    employmentType: 'CDI',
    seniorityLevel: 'JUNIOR',
    minYearsExperience: 1,
    status: 'PUBLISHED',
    profile: 'frontend',
    author: 'rh1',
    publishedDaysAgo: 25,
    expiresInDays: 65,
    questions: [
      { key: 'portfolio', label: 'Lien vers votre portfolio ou GitHub', type: 'SHORT_TEXT', required: false },
      { key: 'frameworks', label: 'Quels frameworks avez-vous deja utilises ?', type: 'MULTI_CHOICE', required: true, options: ['React', 'Next.js', 'Vue.js', 'Angular', 'Svelte'] },
      { key: 'annees_exp', label: "Annees d'experience frontend", type: 'NUMBER', required: true, config: { min: 0, max: 30 } },
    ],
  },
  {
    slug: 'backend-java',
    title: 'Developpeur Backend Java / Spring Boot',
    description:
      "Vous concevez et exposez les APIs du socle applicatif d'un de nos clients du secteur bancaire, dans un environnement exigeant en securite et en disponibilite.",
    requirements: 'Java 17+, Spring Boot, PostgreSQL ou Oracle, Docker. Culture tests et CI/CD.',
    location: 'Tunis — Lac 2',
    employmentType: 'CDI',
    seniorityLevel: 'SENIOR',
    minYearsExperience: 5,
    status: 'PUBLISHED',
    profile: 'backend',
    author: 'rh2',
    publishedDaysAgo: 60,
    expiresInDays: 30,
    questions: [
      { key: 'annees_exp', label: "Annees d'experience sur Java", type: 'NUMBER', required: true, config: { min: 0, max: 40 } },
      { key: 'secteur', label: 'Avez-vous deja travaille dans le secteur bancaire ?', type: 'BOOLEAN', required: true },
      { key: 'archi', label: 'Decrivez une architecture que vous avez concue', type: 'LONG_TEXT', required: true, config: { maxLength: 2000 } },
      { key: 'pretentions', label: 'Pretentions salariales (TND brut annuel)', type: 'SHORT_TEXT', required: false, archived: true },
    ],
  },
  {
    slug: 'devops-kubernetes',
    title: 'Ingenieur DevOps / Cloud (Kubernetes)',
    description:
      "Vous industrialisez les chaines de livraison et operez les plateformes Kubernetes de nos clients, avec un fort enjeu d'observabilite et de maitrise des couts.",
    requirements: 'Kubernetes, Terraform, GitLab CI, un cloud public (AWS ou Azure). Astreinte ponctuelle.',
    location: 'Ariana — Ghazela (Technopark)',
    employmentType: 'CDI',
    seniorityLevel: 'SENIOR',
    minYearsExperience: 4,
    status: 'PUBLISHED',
    profile: 'devops',
    author: 'rh1',
    publishedDaysAgo: 18,
    expiresInDays: 72,
    questions: [
      { key: 'clouds', label: 'Quels clouds avez-vous pratiques ?', type: 'MULTI_CHOICE', required: true, options: ['AWS', 'Azure', 'GCP', 'OVH', 'On-premise'] },
      { key: 'astreinte', label: "Acceptez-vous le principe d'une astreinte ?", type: 'BOOLEAN', required: true },
      { key: 'certifs', label: 'Certifications obtenues', type: 'SHORT_TEXT', required: false },
    ],
  },
  {
    slug: 'data-engineer',
    title: 'Data Engineer',
    description:
      'Vous construisez les pipelines de donnees et le socle analytique de nos clients (retail, energie), de la collecte a la restitution.',
    requirements: 'Python, SQL avance, Spark, orchestration (Airflow). Notions de modelisation dimensionnelle.',
    location: 'Tunis — hybride',
    employmentType: 'CDI',
    seniorityLevel: 'CONFIRMED',
    minYearsExperience: 3,
    status: 'PUBLISHED',
    profile: 'data',
    author: 'rh2',
    publishedDaysAgo: 33,
    expiresInDays: 57,
    questions: [
      { key: 'annees_exp', label: "Annees d'experience data", type: 'NUMBER', required: true, config: { min: 0, max: 30 } },
      { key: 'outils', label: 'Outils de la stack data maitrises', type: 'MULTI_CHOICE', required: true, options: ['Spark', 'Airflow', 'dbt', 'Kafka', 'Power BI'] },
      { key: 'projet', label: 'Decrivez votre projet data le plus significatif', type: 'LONG_TEXT', required: true, config: { maxLength: 1800 } },
    ],
  },
  {
    slug: 'qa-automation',
    title: "Ingenieur QA — automatisation des tests",
    description:
      "Vous mettez en place et faites vivre les strategies de test automatise de nos projets, en lien direct avec les equipes de developpement.",
    requirements: 'Playwright ou Cypress, notions de CI, rigueur de redaction des cas de test.',
    location: 'Sousse — Technopole',
    employmentType: 'CDD',
    seniorityLevel: 'JUNIOR',
    minYearsExperience: 1,
    status: 'PUBLISHED',
    profile: 'qa',
    author: 'rh2',
    publishedDaysAgo: 12,
    expiresInDays: 78,
    questions: [
      { key: 'outils_test', label: 'Quels outils de test avez-vous utilises ?', type: 'MULTI_CHOICE', required: true, options: ['Playwright', 'Cypress', 'Selenium', 'JUnit', 'Postman'] },
      { key: 'duree_cdd', label: 'Un CDD de 12 mois vous convient-il ?', type: 'BOOLEAN', required: true },
    ],
  },
  {
    slug: 'mobile-flutter',
    title: 'Developpeur Mobile Flutter',
    description: "Developpement d'une application self-care pour un operateur telecom, publiee sur les deux stores.",
    requirements: 'Flutter/Dart, consommation d\'APIs REST, publication store.',
    location: 'Tunis — Lac 2',
    employmentType: 'FREELANCE',
    seniorityLevel: 'CONFIRMED',
    minYearsExperience: 3,
    status: 'CLOSED',
    profile: 'mobile',
    author: 'rh1',
    publishedDaysAgo: 200,
    expiresInDays: -20,
    questions: [
      { key: 'tjm', label: 'Quel TJM proposez-vous (TND) ?', type: 'NUMBER', required: true, config: { min: 100, max: 2000 } },
      { key: 'stores', label: 'Avez-vous deja publie sur App Store et Play Store ?', type: 'BOOLEAN', required: true },
    ],
  },
  {
    slug: 'business-analyst',
    title: 'Business Analyst (assurance)',
    description: "Recueil du besoin, redaction des specifications et animation des ateliers metier chez un assureur.",
    requirements: 'Experience assurance ou banque, aisance redactionnelle, anglais professionnel.',
    location: 'Tunis — hybride',
    employmentType: 'CDI',
    seniorityLevel: null,
    minYearsExperience: 2,
    status: 'CLOSED',
    profile: 'management',
    author: 'rh2',
    publishedDaysAgo: 150,
    expiresInDays: -40,
    questions: [
      { key: 'secteurs', label: 'Secteurs sur lesquels vous etes intervenu(e)', type: 'MULTI_CHOICE', required: false, options: ['Assurance', 'Banque', 'Telecom', 'Industrie', 'Sante'] },
      { key: 'anglais', label: 'Niveau d\'anglais', type: 'SINGLE_CHOICE', required: true, options: ['Notions', 'Professionnel', 'Courant', 'Bilingue'] },
    ],
  },
  {
    slug: 'stage-pfe-ia',
    title: "Stage PFE — assistant IA d'analyse de CV",
    description:
      "Stage de fin d'etudes sur l'evaluation assistee par IA des candidatures : prompt engineering, evaluation structuree et integration produit.",
    requirements: 'Derniere annee d\'ingenieur, Python ou TypeScript, curiosite pour les LLM.',
    location: 'Tunis — Lac 2 (presentiel)',
    employmentType: 'STAGE',
    seniorityLevel: 'JUNIOR',
    minYearsExperience: 0,
    status: 'DRAFT',
    profile: 'data',
    author: 'rh1',
    publishedDaysAgo: null,
    expiresInDays: null,
    questions: [
      { key: 'ecole', label: 'Etablissement et filiere', type: 'SHORT_TEXT', required: true },
      { key: 'periode', label: 'Periode de stage souhaitee', type: 'SHORT_TEXT', required: true },
      { key: 'sujet', label: 'Sujet qui vous interesse le plus', type: 'LONG_TEXT', required: false, config: { maxLength: 800 } },
    ],
  },
  {
    slug: 'cybersecurite-ot',
    title: 'Ingenieur Cybersecurite OT',
    description: "Audit et durcissement des environnements industriels d'un acteur de l'energie.",
    requirements: 'Securite des systemes industriels, normes ISO 27001 / IEC 62443, esprit d\'analyse.',
    location: 'Sfax — deplacements sites',
    employmentType: 'CDD',
    seniorityLevel: 'LEAD',
    minYearsExperience: 7,
    status: 'DRAFT',
    profile: 'security',
    author: 'rh2',
    publishedDaysAgo: null,
    expiresInDays: null,
    questions: [
      { key: 'normes', label: 'Normes maitrisees', type: 'MULTI_CHOICE', required: true, options: ['ISO 27001', 'IEC 62443', 'NIST CSF', 'ANSSI'] },
      { key: 'habilitation', label: 'Etes-vous habilitable pour des sites sensibles ?', type: 'BOOLEAN', required: true },
    ],
  },
];
