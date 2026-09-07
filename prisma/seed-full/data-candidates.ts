/**
 * The recruitment pipeline: 30 candidates covering every `CandidateStatus`.
 *
 * The six HIRED entries (k01–k06) are the same people as the consultants that
 * declare `fromCandidate` — that is what conversion means: the Candidate row
 * keeps the PERSONAL email used during recruitment, while the Consultant gets a
 * generated `prenom.nom@esn.local` company identity.
 */
import type { CandidateStatus } from '@prisma/client';
import type { SKILL_PROFILES } from './data-skills.js';

export interface CandidateSeed {
  key: string;
  firstName: string;
  lastName: string;
  /** Personal mailbox — never @esn.local. */
  email: string;
  status: CandidateStatus;
  targetPosition: string;
  profile: keyof typeof SKILL_PROFILES;
  source: string;
  notes: string;
  /** Days ago the application landed. */
  appliedDaysAgo: number;
  /** Job post slug this candidate came from, when sourced by the portal. */
  fromJobPost?: string;
}

export const CANDIDATES: readonly CandidateSeed[] = [
  // --- HIRED (converted to consultants) -----------------------------------
  { key: 'k01', firstName: 'Hamza', lastName: 'Louati', email: 'hamza.louati@gmail.com', status: 'HIRED', targetPosition: 'Developpeur Full-Stack', profile: 'fullstack', source: 'Portail carrieres', notes: 'Tres bon niveau JS/TS pour un profil junior. Integre depuis.', appliedDaysAgo: 300, fromJobPost: 'fullstack-tunis' },
  { key: 'k02', firstName: 'Dorra', lastName: 'Karoui', email: 'dorra.karoui@outlook.fr', status: 'HIRED', targetPosition: 'Ingenieur QA', profile: 'qa', source: 'Forum INSAT', notes: 'Profil QA junior serieux, montee en competence rapide sur Playwright.', appliedDaysAgo: 380, fromJobPost: 'qa-automation' },
  { key: 'k03', firstName: 'Hiba', lastName: 'Ouali', email: 'hiba.ouali@gmail.com', status: 'HIRED', targetPosition: 'Developpeur Frontend', profile: 'frontend', source: 'LinkedIn', notes: 'Portfolio React solide. Recrutee sur le portail courtiers.', appliedDaysAgo: 340, fromJobPost: 'frontend-react' },
  { key: 'k04', firstName: 'Fares', lastName: 'Chakroun', email: 'fares.chakroun@yahoo.fr', status: 'HIRED', targetPosition: 'Developpeur Backend', profile: 'backend', source: 'Cooptation', notes: 'Coopte par Bilel Nasri. Bon socle Java/Spring.', appliedDaysAgo: 230, fromJobPost: 'backend-java' },
  { key: 'k05', firstName: 'Wassim', lastName: 'Ferchichi', email: 'wassim.ferchichi@gmail.com', status: 'HIRED', targetPosition: 'Developpeur Mobile', profile: 'mobile', source: 'Cabinet de recrutement', notes: 'Deux applications Flutter en production a son actif.', appliedDaysAgo: 560, fromJobPost: 'mobile-flutter' },
  { key: 'k06', firstName: 'Ines', lastName: 'Haddad', email: 'ines.haddad@topnet.tn', status: 'HIRED', targetPosition: 'Developpeur Full-Stack', profile: 'fullstack', source: 'Candidature spontanee', notes: 'Reconversion reussie, tres autonome. En attente de staffing.', appliedDaysAgo: 640 },
  // --- VALIDATED (offer stage) --------------------------------------------
  { key: 'k07', firstName: 'Aymen', lastName: 'Bouzid', email: 'aymen.bouzid@gmail.com', status: 'VALIDATED', targetPosition: 'Ingenieur DevOps', profile: 'devops', source: 'LinkedIn', notes: 'Valide par le Manager. Proposition envoyee, reponse attendue.', appliedDaysAgo: 45, fromJobPost: 'devops-kubernetes' },
  { key: 'k08', firstName: 'Syrine', lastName: 'Jelassi', email: 'syrine.jelassi@outlook.fr', status: 'VALIDATED', targetPosition: 'Data Engineer', profile: 'data', source: 'Salon de recrutement', notes: 'Profil data confirme, negociation TJM en cours.', appliedDaysAgo: 38, fromJobPost: 'data-engineer' },
  { key: 'k09', firstName: 'Marouane', lastName: 'Riahi', email: 'marouane.riahi@gmail.com', status: 'VALIDATED', targetPosition: 'Architecte Logiciel', profile: 'backend', source: 'Cooptation', notes: 'Excellent retour technique. Cible : compte Sante+.', appliedDaysAgo: 52 },
  { key: 'k10', firstName: 'Khaoula', lastName: 'Hachicha', email: 'khaoula.hachicha@yahoo.fr', status: 'VALIDATED', targetPosition: 'Business Analyst', profile: 'management', source: 'Portail carrieres', notes: 'Bon relationnel client, experience assurance.', appliedDaysAgo: 29, fromJobPost: 'business-analyst' },
  // --- INTERVIEW ----------------------------------------------------------
  { key: 'k11', firstName: 'Nizar', lastName: 'Grira', email: 'nizar.grira@gmail.com', status: 'INTERVIEW', targetPosition: 'Ingenieur Cloud', profile: 'devops', source: 'LinkedIn', notes: 'Entretien technique planifie avec Zied Charfi.', appliedDaysAgo: 21, fromJobPost: 'devops-kubernetes' },
  { key: 'k12', firstName: 'Meriem', lastName: 'Bellagha', email: 'meriem.bellagha@outlook.fr', status: 'INTERVIEW', targetPosition: 'Developpeur Frontend', profile: 'frontend', source: 'Forum ENIT', notes: 'Premier entretien RH concluant.', appliedDaysAgo: 18, fromJobPost: 'frontend-react' },
  { key: 'k13', firstName: 'Sofiene', lastName: 'Ben Salah', email: 'sofiene.bensalah@gmail.com', status: 'INTERVIEW', targetPosition: 'Developpeur Backend', profile: 'backend', source: 'Cooptation', notes: 'A confirmer sur la partie architecture.', appliedDaysAgo: 26, fromJobPost: 'backend-java' },
  { key: 'k14', firstName: 'Ghada', lastName: 'Gharbi', email: 'ghada.gharbi@topnet.tn', status: 'INTERVIEW', targetPosition: 'Ingenieur QA', profile: 'qa', source: 'Portail carrieres', notes: 'Test technique envoye.', appliedDaysAgo: 15, fromJobPost: 'qa-automation' },
  { key: 'k15', firstName: 'Anis', lastName: 'Zouari', email: 'anis.zouari@gmail.com', status: 'INTERVIEW', targetPosition: 'Consultant ERP', profile: 'erp', source: 'Cabinet de recrutement', notes: 'Experience SAP MM/PP chez un industriel de Sfax.', appliedDaysAgo: 33 },
  { key: 'k16', firstName: 'Imen', lastName: 'Trabelsi', email: 'imen.trabelsi@yahoo.fr', status: 'INTERVIEW', targetPosition: 'Data Scientist', profile: 'data', source: 'LinkedIn', notes: 'These en ML, a evaluer sur la mise en production.', appliedDaysAgo: 24, fromJobPost: 'data-engineer' },
  // --- APPLIED ------------------------------------------------------------
  { key: 'k17', firstName: 'Walid', lastName: 'Mansouri', email: 'walid.mansouri@gmail.com', status: 'APPLIED', targetPosition: 'Developpeur Full-Stack', profile: 'fullstack', source: 'Portail carrieres', notes: 'A qualifier.', appliedDaysAgo: 5, fromJobPost: 'fullstack-tunis' },
  { key: 'k18', firstName: 'Rim', lastName: 'Chaabane', email: 'rim.chaabane@outlook.fr', status: 'APPLIED', targetPosition: 'Developpeur Frontend', profile: 'frontend', source: 'LinkedIn', notes: '', appliedDaysAgo: 3, fromJobPost: 'frontend-react' },
  { key: 'k19', firstName: 'Adem', lastName: 'Ben Ammar', email: 'adem.benammar@gmail.com', status: 'APPLIED', targetPosition: 'Ingenieur DevOps', profile: 'devops', source: 'Candidature spontanee', notes: 'CV recu par mail, a rattacher a une offre.', appliedDaysAgo: 8 },
  { key: 'k20', firstName: 'Takwa', lastName: 'Sassi', email: 'takwa.sassi@yahoo.fr', status: 'APPLIED', targetPosition: 'Ingenieur QA', profile: 'qa', source: 'Portail carrieres', notes: '', appliedDaysAgo: 2, fromJobPost: 'qa-automation' },
  { key: 'k21', firstName: 'Firas', lastName: 'Hamdi', email: 'firas.hamdi@gmail.com', status: 'APPLIED', targetPosition: 'Developpeur Backend', profile: 'backend', source: 'Forum INSAT', notes: 'Jeune diplome.', appliedDaysAgo: 11, fromJobPost: 'backend-java' },
  { key: 'k22', firstName: 'Cyrine', lastName: 'Nasri', email: 'cyrine.nasri@topnet.tn', status: 'APPLIED', targetPosition: 'Data Engineer', profile: 'data', source: 'LinkedIn', notes: '', appliedDaysAgo: 6, fromJobPost: 'data-engineer' },
  { key: 'k23', firstName: 'Nader', lastName: 'Ayari', email: 'nader.ayari@gmail.com', status: 'APPLIED', targetPosition: 'Developpeur Mobile', profile: 'mobile', source: 'Cooptation', notes: 'Coopte par Wassim Ferchichi.', appliedDaysAgo: 9, fromJobPost: 'mobile-flutter' },
  { key: 'k24', firstName: 'Hela', lastName: 'Dridi', email: 'hela.dridi@outlook.fr', status: 'APPLIED', targetPosition: 'Business Analyst', profile: 'management', source: 'Salon de recrutement', notes: '', appliedDaysAgo: 13, fromJobPost: 'business-analyst' },
  { key: 'k25', firstName: 'Amine', lastName: 'Ferchichi', email: 'amine.ferchichi@gmail.com', status: 'APPLIED', targetPosition: 'Ingenieur Cybersecurite', profile: 'security', source: 'LinkedIn', notes: 'Certifie, a contacter rapidement.', appliedDaysAgo: 4 },
  // --- REJECTED -----------------------------------------------------------
  { key: 'k26', firstName: 'Chaker', lastName: 'Rekik', email: 'chaker.rekik@gmail.com', status: 'REJECTED', targetPosition: 'Developpeur Full-Stack', profile: 'fullstack', source: 'Portail carrieres', notes: 'Niveau technique insuffisant sur le test.', appliedDaysAgo: 90, fromJobPost: 'fullstack-tunis' },
  { key: 'k27', firstName: 'Nesrine', lastName: 'Charfi', email: 'nesrine.charfi@yahoo.fr', status: 'REJECTED', targetPosition: 'Ingenieur QA', profile: 'qa', source: 'LinkedIn', notes: 'Pretentions hors grille pour le poste.', appliedDaysAgo: 75 },
  { key: 'k28', firstName: 'Aya', lastName: 'Baccouche', email: 'aya.baccouche@outlook.fr', status: 'REJECTED', targetPosition: 'Developpeur Frontend', profile: 'frontend', source: 'Forum ENIT', notes: 'A retenter dans 12 mois, profil trop junior.', appliedDaysAgo: 110, fromJobPost: 'frontend-react' },
  { key: 'k29', firstName: 'Skander', lastName: 'Guesmi', email: 'skander.guesmi@gmail.com', status: 'REJECTED', targetPosition: 'Ingenieur Cloud', profile: 'devops', source: 'Cabinet de recrutement', notes: 'A decline le process apres le premier entretien.', appliedDaysAgo: 68 },
  { key: 'k30', firstName: 'Olfa', lastName: 'Belhaj', email: 'olfa.belhaj@topnet.tn', status: 'REJECTED', targetPosition: 'Consultant ERP', profile: 'erp', source: 'Candidature spontanee', notes: 'Pas de besoin ouvert sur ce profil.', appliedDaysAgo: 130 },
];
