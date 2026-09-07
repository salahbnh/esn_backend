/**
 * Tunisian identity pools + the fictional client companies the dataset staffs.
 *
 * Company names are deliberately invented (no real Tunisian bank, telco or
 * insurer is referenced) so the fixture can never be mistaken for real customer
 * data. People are ordinary Tunisian given names / family names.
 */

export const MALE_FIRST_NAMES = [
  'Mohamed', 'Ahmed', 'Youssef', 'Yassine', 'Karim', 'Slim', 'Mehdi', 'Hedi',
  'Nizar', 'Bilel', 'Sofiene', 'Anis', 'Wassim', 'Oussama', 'Aymen', 'Zied',
  'Marouane', 'Hamza', 'Skander', 'Ramzi', 'Tarek', 'Fares', 'Malek', 'Seif',
  'Chaker', 'Walid', 'Amine', 'Firas', 'Adem', 'Nader',
] as const;

export const FEMALE_FIRST_NAMES = [
  'Amira', 'Sonia', 'Nadia', 'Leila', 'Ines', 'Rania', 'Salma', 'Emna',
  'Yosra', 'Mariem', 'Asma', 'Dorra', 'Hiba', 'Nour', 'Farah', 'Sarra',
  'Olfa', 'Wafa', 'Sihem', 'Khaoula', 'Meriem', 'Ghada', 'Imen', 'Syrine',
  'Aya', 'Rim', 'Takwa', 'Cyrine', 'Nesrine', 'Hela',
] as const;

export const LAST_NAMES = [
  'Ben Ammar', 'Trabelsi', 'Bouazizi', 'Khelifi', 'Gharbi', 'Mansouri',
  'Chaabane', 'Ben Said', 'Zouari', 'Jendoubi', 'Sassi', 'Hamdi', 'Nasri',
  'Ben Youssef', 'Ayari', 'Dridi', 'Ferchichi', 'Rekik', 'Ben Salah', 'Charfi',
  'Guesmi', 'Louati', 'Baccouche', 'Ben Hassine', 'Karoui', 'Mejri', 'Ouali',
  'Belhaj', 'Tounsi', 'Chakroun', 'Maaloul', 'Sfaxi', 'Haddad', 'Abidi',
  'Bouzid', 'Jelassi', 'Riahi', 'Hachicha', 'Bellagha', 'Grira',
] as const;

export const CITIES = [
  'Tunis', 'Ariana', 'Ben Arous', 'La Marsa', 'Sfax', 'Sousse', 'Nabeul',
  'Bizerte', 'Monastir', 'Gabes',
] as const;

/** Where missions are executed — Tunisian sites plus the usual offshore setups. */
export const MISSION_LOCATIONS = [
  'Tunis — Lac 2 (sur site)', 'Tunis — Centre Urbain Nord', 'Sfax — Poudriere',
  'Sousse — Technopole', 'Ariana — Ghazela (Technopark)', 'Remote (Tunisie)',
  'Hybride — Tunis / Remote', 'Nearshore — client Paris (remote depuis Tunis)',
] as const;

export interface ClientSeed {
  slug: string;
  name: string;
  industry: string;
  contactFirst: string;
  contactLast: string;
}

/** Ten fictional Tunisian accounts, spread across industries. */
export const CLIENTS: readonly ClientSeed[] = [
  { slug: 'medina-bank', name: 'Medina Bank', industry: 'Banque', contactFirst: 'Faouzi', contactLast: 'Belhaj' },
  { slug: 'carthage-assurances', name: 'Carthage Assurances', industry: 'Assurance', contactFirst: 'Ines', contactLast: 'Karoui' },
  { slug: 'nour-telecom', name: 'Nour Telecom', industry: 'Telecommunications', contactFirst: 'Sami', contactLast: 'Gharbi' },
  { slug: 'ifriqiya-logistics', name: 'Ifriqiya Logistics', industry: 'Transport & Logistique', contactFirst: 'Rania', contactLast: 'Dridi' },
  { slug: 'el-olja-distribution', name: 'El Olja Distribution', industry: 'Grande distribution', contactFirst: 'Nizar', contactLast: 'Sassi' },
  { slug: 'sahara-energy', name: 'Sahara Energy Tunisie', industry: 'Energie', contactFirst: 'Hatem', contactLast: 'Mejri' },
  { slug: 'sfax-industries', name: 'Sfax Industries Mecaniques', industry: 'Industrie', contactFirst: 'Olfa', contactLast: 'Chakroun' },
  { slug: 'sante-plus', name: 'Sante+ Tunisie', industry: 'Sante', contactFirst: 'Mouna', contactLast: 'Rekik' },
  { slug: 'jasmin-media', name: 'Jasmin Media Group', industry: 'Medias', contactFirst: 'Bilel', contactLast: 'Louati' },
  { slug: 'utique-aerospace', name: 'Utique Aerospace', industry: 'Aeronautique', contactFirst: 'Skander', contactLast: 'Baccouche' },
];

/** Consultant job titles, roughly ordered by seniority band. */
export const POSITIONS = [
  'Developpeur Full-Stack', 'Developpeur Backend', 'Developpeur Frontend',
  'Ingenieur DevOps', 'Data Engineer', 'Data Scientist', 'Architecte Logiciel',
  'Tech Lead', 'Ingenieur QA', 'Business Analyst', 'Chef de Projet',
  'Administrateur Base de Donnees', 'Ingenieur Cybersecurite',
  'Developpeur Mobile', 'Consultant ERP', 'Ingenieur Cloud',
] as const;

export const SENIORITIES = ['Junior', 'Confirme', 'Senior', 'Lead'] as const;

/** How a candidate reached the pipeline. */
export const CANDIDATE_SOURCES = [
  'LinkedIn', 'Cooptation', 'Portail carrieres', 'Salon de recrutement',
  'Candidature spontanee', 'Cabinet de recrutement', 'Forum ENIT', 'Forum INSAT',
] as const;
