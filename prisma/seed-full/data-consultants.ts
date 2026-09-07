/**
 * The bench: 25 consultants, declared explicitly rather than generated, so the
 * mix of positions, seniorities and availability is deliberate and stable.
 *
 * `status` drives staffing in `step-assignments.ts`:
 *   ON_MISSION   -> an ACTIVE assignment on an IN_PROGRESS mission
 *   INTERCONTRAT -> a CONFIRMED assignment starting later (or nothing yet)
 *   AVAILABLE    -> at most a PROPOSED assignment on a mission being scoped
 *
 * `fromCandidate` marks the consultants that came through the ATS: their
 * `candidateId` links back to the HIRED candidate they were converted from.
 */
import type { ConsultantStatus } from '@prisma/client';
import type { SKILL_PROFILES } from './data-skills.js';

export interface ConsultantSeed {
  key: string;
  firstName: string;
  lastName: string;
  position: string;
  seniority: 'Junior' | 'Confirme' | 'Senior' | 'Lead';
  profile: keyof typeof SKILL_PROFILES;
  status: ConsultantStatus;
  /** Years since hire — drives hireDate. */
  tenureMonths: number;
  /** Candidate key this consultant was converted from, if any. */
  fromCandidate?: string;
  /** Forces the login address (only the shipped dev account needs this). */
  emailOverride?: string;
}

export const CONSULTANTS: readonly ConsultantSeed[] = [
  // --- On mission ---------------------------------------------------------
  { key: 'c01', firstName: 'Yassine', lastName: 'Khelifi', position: 'Developpeur Full-Stack', seniority: 'Senior', profile: 'fullstack', status: 'ON_MISSION', tenureMonths: 38, emailOverride: 'consultant@esn.local' },
  { key: 'c02', firstName: 'Mariem', lastName: 'Jendoubi', position: 'Developpeur Frontend', seniority: 'Confirme', profile: 'frontend', status: 'ON_MISSION', tenureMonths: 26 },
  { key: 'c03', firstName: 'Oussama', lastName: 'Sassi', position: 'Ingenieur DevOps', seniority: 'Senior', profile: 'devops', status: 'ON_MISSION', tenureMonths: 44 },
  { key: 'c04', firstName: 'Emna', lastName: 'Hamdi', position: 'Data Engineer', seniority: 'Confirme', profile: 'data', status: 'ON_MISSION', tenureMonths: 19 },
  { key: 'c05', firstName: 'Bilel', lastName: 'Nasri', position: 'Developpeur Backend', seniority: 'Senior', profile: 'backend', status: 'ON_MISSION', tenureMonths: 52 },
  { key: 'c06', firstName: 'Rania', lastName: 'Ben Youssef', position: 'Business Analyst', seniority: 'Confirme', profile: 'management', status: 'ON_MISSION', tenureMonths: 23 },
  { key: 'c07', firstName: 'Ahmed', lastName: 'Ayari', position: 'Architecte Logiciel', seniority: 'Lead', profile: 'backend', status: 'ON_MISSION', tenureMonths: 67 },
  { key: 'c08', firstName: 'Salma', lastName: 'Dridi', position: 'Ingenieur QA', seniority: 'Confirme', profile: 'qa', status: 'ON_MISSION', tenureMonths: 21 },
  { key: 'c09', firstName: 'Wassim', lastName: 'Ferchichi', position: 'Developpeur Mobile', seniority: 'Confirme', profile: 'mobile', status: 'ON_MISSION', tenureMonths: 17, fromCandidate: 'k05' },
  { key: 'c10', firstName: 'Nour', lastName: 'Rekik', position: 'Data Scientist', seniority: 'Senior', profile: 'data', status: 'ON_MISSION', tenureMonths: 34 },
  { key: 'c11', firstName: 'Zied', lastName: 'Charfi', position: 'Ingenieur Cloud', seniority: 'Senior', profile: 'devops', status: 'ON_MISSION', tenureMonths: 41 },
  { key: 'c12', firstName: 'Yosra', lastName: 'Guesmi', position: 'Chef de Projet', seniority: 'Senior', profile: 'management', status: 'ON_MISSION', tenureMonths: 58 },
  { key: 'c13', firstName: 'Hamza', lastName: 'Louati', position: 'Developpeur Full-Stack', seniority: 'Junior', profile: 'fullstack', status: 'ON_MISSION', tenureMonths: 8, fromCandidate: 'k01' },
  { key: 'c14', firstName: 'Asma', lastName: 'Baccouche', position: 'Developpeur Backend', seniority: 'Confirme', profile: 'backend', status: 'ON_MISSION', tenureMonths: 29 },
  // --- Intercontrat -------------------------------------------------------
  { key: 'c15', firstName: 'Skander', lastName: 'Ben Hassine', position: 'Tech Lead', seniority: 'Lead', profile: 'fullstack', status: 'INTERCONTRAT', tenureMonths: 62 },
  { key: 'c16', firstName: 'Dorra', lastName: 'Karoui', position: 'Ingenieur QA', seniority: 'Junior', profile: 'qa', status: 'INTERCONTRAT', tenureMonths: 11, fromCandidate: 'k02' },
  { key: 'c17', firstName: 'Ramzi', lastName: 'Mejri', position: 'Consultant ERP', seniority: 'Senior', profile: 'erp', status: 'INTERCONTRAT', tenureMonths: 47 },
  { key: 'c18', firstName: 'Hiba', lastName: 'Ouali', position: 'Developpeur Frontend', seniority: 'Junior', profile: 'frontend', status: 'INTERCONTRAT', tenureMonths: 9, fromCandidate: 'k03' },
  { key: 'c19', firstName: 'Tarek', lastName: 'Belhaj', position: 'Ingenieur Cybersecurite', seniority: 'Senior', profile: 'security', status: 'INTERCONTRAT', tenureMonths: 36 },
  // --- Disponibles --------------------------------------------------------
  { key: 'c20', firstName: 'Farah', lastName: 'Tounsi', position: 'Administrateur Base de Donnees', seniority: 'Confirme', profile: 'backend', status: 'AVAILABLE', tenureMonths: 25 },
  { key: 'c21', firstName: 'Fares', lastName: 'Chakroun', position: 'Developpeur Backend', seniority: 'Junior', profile: 'backend', status: 'AVAILABLE', tenureMonths: 6, fromCandidate: 'k04' },
  { key: 'c22', firstName: 'Sarra', lastName: 'Maaloul', position: 'Developpeur Mobile', seniority: 'Junior', profile: 'mobile', status: 'AVAILABLE', tenureMonths: 14 },
  { key: 'c23', firstName: 'Malek', lastName: 'Sfaxi', position: 'Data Engineer', seniority: 'Confirme', profile: 'data', status: 'AVAILABLE', tenureMonths: 31 },
  { key: 'c24', firstName: 'Ines', lastName: 'Haddad', position: 'Developpeur Full-Stack', seniority: 'Confirme', profile: 'fullstack', status: 'AVAILABLE', tenureMonths: 20, fromCandidate: 'k06' },
  { key: 'c25', firstName: 'Seif', lastName: 'Abidi', position: 'Ingenieur DevOps', seniority: 'Junior', profile: 'devops', status: 'AVAILABLE', tenureMonths: 5 },
];

/** TJM band (min, max) per seniority, in TND. */
export const TJM_BANDS: Record<ConsultantSeed['seniority'], [number, number]> = {
  Junior: [320, 420],
  Confirme: [430, 550],
  Senior: [560, 700],
  Lead: [720, 880],
};
