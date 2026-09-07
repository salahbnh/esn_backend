/**
 * Portal applications that were NOT linked into the ATS.
 *
 * The linked ones are generated from the candidates that carry a `fromJobPost`
 * (see step-applications.ts) — those two rows describe the same person. These
 * are the rest of the funnel: still to be triaged, refused, or spam.
 */
import type { ApplicationStatus } from '@prisma/client';

export interface ApplicantSeed {
  firstName: string;
  lastName: string;
  email: string;
  jobPost: string;
  status: ApplicationStatus;
  daysAgo: number;
  rejectionReason?: string;
}

export const EXTRA_APPLICANTS: readonly ApplicantSeed[] = [
  // --- SUBMITTED: untouched, waiting for RH triage ------------------------
  { firstName: 'Bassem', lastName: 'Khemiri', email: 'bassem.khemiri@gmail.com', jobPost: 'fullstack-tunis', status: 'SUBMITTED', daysAgo: 1 },
  { firstName: 'Marwa', lastName: 'Slimani', email: 'marwa.slimani@outlook.fr', jobPost: 'frontend-react', status: 'SUBMITTED', daysAgo: 2 },
  { firstName: 'Ayoub', lastName: 'Zaidi', email: 'ayoub.zaidi@gmail.com', jobPost: 'devops-kubernetes', status: 'SUBMITTED', daysAgo: 2 },
  { firstName: 'Sabrine', lastName: 'Ben Romdhane', email: 'sabrine.benromdhane@yahoo.fr', jobPost: 'data-engineer', status: 'SUBMITTED', daysAgo: 4 },
  { firstName: 'Hatem', lastName: 'Chouchane', email: 'hatem.chouchane@topnet.tn', jobPost: 'backend-java', status: 'SUBMITTED', daysAgo: 5 },
  { firstName: 'Nihel', lastName: 'Ben Abdallah', email: 'nihel.benabdallah@gmail.com', jobPost: 'qa-automation', status: 'SUBMITTED', daysAgo: 3 },
  { firstName: 'Oussama', lastName: 'Latrach', email: 'oussama.latrach@outlook.fr', jobPost: 'fullstack-tunis', status: 'SUBMITTED', daysAgo: 7 },
  { firstName: 'Amal', lastName: 'Werghi', email: 'amal.werghi@gmail.com', jobPost: 'devops-kubernetes', status: 'SUBMITTED', daysAgo: 6 },
  // --- UNDER_REVIEW: RH has opened them -----------------------------------
  { firstName: 'Zeineb', lastName: 'Mabrouk', email: 'zeineb.mabrouk@gmail.com', jobPost: 'frontend-react', status: 'UNDER_REVIEW', daysAgo: 9 },
  { firstName: 'Ghazi', lastName: 'Ben Slimane', email: 'ghazi.benslimane@yahoo.fr', jobPost: 'backend-java', status: 'UNDER_REVIEW', daysAgo: 12 },
  { firstName: 'Rihab', lastName: 'Nouri', email: 'rihab.nouri@outlook.fr', jobPost: 'data-engineer', status: 'UNDER_REVIEW', daysAgo: 10 },
  { firstName: 'Iheb', lastName: 'Selmi', email: 'iheb.selmi@gmail.com', jobPost: 'fullstack-tunis', status: 'UNDER_REVIEW', daysAgo: 14 },
  { firstName: 'Sana', lastName: 'Ben Amor', email: 'sana.benamor@topnet.tn', jobPost: 'qa-automation', status: 'UNDER_REVIEW', daysAgo: 8 },
  // --- REJECTED -----------------------------------------------------------
  { firstName: 'Montassar', lastName: 'Ghedira', email: 'montassar.ghedira@gmail.com', jobPost: 'backend-java', status: 'REJECTED', daysAgo: 40, rejectionReason: "Experience Java tres en deca des 5 ans demandes." },
  { firstName: 'Emna', lastName: 'Bouraoui', email: 'emna.bouraoui@yahoo.fr', jobPost: 'devops-kubernetes', status: 'REJECTED', daysAgo: 35, rejectionReason: 'Pas de pratique Kubernetes en production.' },
  { firstName: 'Nabil', lastName: 'Ammar', email: 'nabil.ammar@outlook.fr', jobPost: 'mobile-flutter', status: 'REJECTED', daysAgo: 120, rejectionReason: 'Offre pourvue avant la fin du processus.' },
  // --- SPAM: what the honeypot / triage catches ---------------------------
  { firstName: 'Best', lastName: 'Offers', email: 'promo@cheap-seo-backlinks.example', jobPost: 'fullstack-tunis', status: 'SPAM', daysAgo: 16 },
  { firstName: 'Crypto', lastName: 'Invest', email: 'invest@quick-profit.example', jobPost: 'frontend-react', status: 'SPAM', daysAgo: 22 },
];
