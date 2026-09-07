/**
 * Clients and their missions.
 *
 * Twenty missions spread over ten accounts and every `MissionStatus`, with
 * dates arranged around today so the dashboards have a real past, present and
 * pipeline: CLOSED/ARCHIVED missions ended months ago, IN_PROGRESS ones straddle
 * today, STAFFED ones start soon and DRAFT ones are still being scoped.
 */
import type { MissionStatus, PrismaClient } from '@prisma/client';
import { CLIENTS, MISSION_LOCATIONS } from './data-names.js';
import { SKILL_PROFILES } from './data-skills.js';
import { sid, n2 } from './ids.js';
import { type Rng, days, int, pick, sample } from './rng.js';

interface MissionSeed {
  client: string;
  project: string;
  role: string;
  profile: keyof typeof SKILL_PROFILES;
  status: MissionStatus;
  /** Day offsets from today. */
  start: number;
  end: number | null;
  tjm: number;
}

const MISSIONS: readonly MissionSeed[] = [
  // Medina Bank
  { client: 'medina-bank', project: 'Refonte du portail e-banking', role: 'Developpeur Frontend', profile: 'frontend', status: 'IN_PROGRESS', start: -210, end: 120, tjm: 620 },
  { client: 'medina-bank', project: 'Socle API Open Banking', role: 'Developpeur Backend', profile: 'backend', status: 'IN_PROGRESS', start: -150, end: 180, tjm: 680 },
  { client: 'medina-bank', project: 'Datalake conformite reglementaire', role: 'Data Engineer', profile: 'data', status: 'STAFFED', start: 21, end: 380, tjm: 700 },
  // Carthage Assurances
  { client: 'carthage-assurances', project: 'Digitalisation de la gestion des sinistres', role: 'Developpeur Full-Stack', profile: 'fullstack', status: 'IN_PROGRESS', start: -300, end: 90, tjm: 590 },
  { client: 'carthage-assurances', project: 'Portail courtiers partenaires', role: 'Developpeur Frontend', profile: 'frontend', status: 'CLOSED', start: -640, end: -180, tjm: 520 },
  // Nour Telecom
  { client: 'nour-telecom', project: 'Migration OSS/BSS vers le cloud', role: 'Ingenieur Cloud', profile: 'devops', status: 'IN_PROGRESS', start: -240, end: 210, tjm: 750 },
  { client: 'nour-telecom', project: 'Application mobile self-care', role: 'Developpeur Mobile', profile: 'mobile', status: 'IN_PROGRESS', start: -120, end: 150, tjm: 560 },
  { client: 'nour-telecom', project: 'Observabilite du reseau coeur', role: 'Ingenieur DevOps', profile: 'devops', status: 'DRAFT', start: 60, end: 420, tjm: 720 },
  // Ifriqiya Logistics
  { client: 'ifriqiya-logistics', project: 'TMS - suivi de flotte temps reel', role: 'Developpeur Full-Stack', profile: 'fullstack', status: 'IN_PROGRESS', start: -180, end: 240, tjm: 610 },
  { client: 'ifriqiya-logistics', project: 'Interfaces EDI partenaires', role: 'Developpeur Backend', profile: 'backend', status: 'CLOSED', start: -540, end: -120, tjm: 545 },
  // El Olja Distribution
  { client: 'el-olja-distribution', project: 'Caisse et encaissement omnicanal', role: 'Tech Lead', profile: 'fullstack', status: 'IN_PROGRESS', start: -330, end: 60, tjm: 820 },
  { client: 'el-olja-distribution', project: 'Pilotage des ventes (BI)', role: 'Data Scientist', profile: 'data', status: 'STAFFED', start: 14, end: 300, tjm: 690 },
  // Sahara Energy
  { client: 'sahara-energy', project: 'SCADA - portail de supervision', role: 'Developpeur Backend', profile: 'backend', status: 'IN_PROGRESS', start: -90, end: 270, tjm: 660 },
  { client: 'sahara-energy', project: 'Audit et durcissement cybersecurite OT', role: 'Ingenieur Cybersecurite', profile: 'security', status: 'STAFFED', start: 30, end: 200, tjm: 780 },
  // Sfax Industries
  { client: 'sfax-industries', project: 'MES - suivi de production atelier', role: 'Consultant ERP', profile: 'erp', status: 'IN_PROGRESS', start: -400, end: 45, tjm: 640 },
  { client: 'sfax-industries', project: 'Portail fournisseurs', role: 'Developpeur Full-Stack', profile: 'fullstack', status: 'ARCHIVED', start: -900, end: -480, tjm: 480 },
  // Sante+
  { client: 'sante-plus', project: 'Dossier patient informatise', role: 'Architecte Logiciel', profile: 'backend', status: 'IN_PROGRESS', start: -270, end: 330, tjm: 800 },
  { client: 'sante-plus', project: 'Prise de rendez-vous en ligne', role: 'Developpeur Frontend', profile: 'frontend', status: 'CLOSED', start: -480, end: -150, tjm: 500 },
  // Jasmin Media
  { client: 'jasmin-media', project: 'Back-office de la plateforme de streaming', role: 'Developpeur Backend', profile: 'backend', status: 'DRAFT', start: 45, end: 400, tjm: 630 },
  // Utique Aerospace
  { client: 'utique-aerospace', project: 'Tracabilite des pieces - recette automatisee', role: 'Ingenieur QA', profile: 'qa', status: 'ARCHIVED', start: -820, end: -420, tjm: 540 },
];

export interface MissionsResult {
  clientIds: Map<string, string>;
  /** Missions in declaration order, with the data staffing needs. */
  missions: Array<{ id: string; profile: string; status: MissionStatus; start: number; end: number | null; tjm: number; project: string; clientId: string }>;
}

export async function seedClientsAndMissions(
  prisma: PrismaClient,
  rng: Rng,
  skillIds: Map<string, string>,
): Promise<MissionsResult> {
  const clientIds = new Map<string, string>();

  for (const [index, client] of CLIENTS.entries()) {
    const row = await prisma.client.create({
      data: {
        id: sid(`client-${n2(index + 1)}`),
        name: client.name,
        industry: client.industry,
        contactName: `${client.contactFirst} ${client.contactLast}`,
        // Contact addresses use the client's own domain, never @esn.local.
        contactEmail: `${client.contactFirst}.${client.contactLast}`
          .toLowerCase()
          .replace(/[^a-z.]/g, '')
          .concat(`@${client.slug.replace(/-/g, '')}.tn`),
        createdAt: days(-int(rng, 400, 900)),
      },
    });
    clientIds.set(client.slug, row.id);
  }

  const missions: MissionsResult['missions'] = [];

  for (const [index, m] of MISSIONS.entries()) {
    const clientId = clientIds.get(m.client);
    if (!clientId) throw new Error(`Unknown client slug in mission seed: ${m.client}`);

    const profileSkills = SKILL_PROFILES[m.profile] ?? [];
    const required = sample(rng, profileSkills, int(rng, 3, 4))
      .map((name) => skillIds.get(name))
      .filter((id): id is string => id !== undefined);

    const id = sid(`mission-${n2(index + 1)}`);
    await prisma.mission.create({
      data: {
        id,
        clientId,
        project: m.project,
        role: m.role,
        description: `${m.project} pour le compte de ${CLIENTS.find((c) => c.slug === m.client)?.name}. Intervention en ${pick(rng, MISSION_LOCATIONS)}. Equipe projet cote client + pilotage ESN hebdomadaire.`,
        startDate: days(m.start),
        endDate: m.end === null ? null : days(m.end),
        tjm: m.tjm.toFixed(2),
        status: m.status,
        // Soft-delete marker: only ARCHIVED missions carry one.
        archivedAt: m.status === 'ARCHIVED' ? days(m.end === null ? -30 : m.end + 30) : null,
        createdAt: days(m.start - int(rng, 20, 60)),
        requiredSkills: { connect: required.map((skillId) => ({ id: skillId })) },
      },
    });

    missions.push({ id, profile: m.profile, status: m.status, start: m.start, end: m.end, tjm: m.tjm, project: m.project, clientId });
  }

  return { clientIds, missions };
}
