/**
 * Referential data: skills + contract templates.
 *
 * Both are upserted by `name` (their natural key) so ids stay stable across
 * runs. The three templates match `prisma/seed.ts` — same names and the same
 * `{{placeholder}}` contract, since `contracts.prefill` treats any token outside
 * AUTO_PLACEHOLDERS as a MANUAL field RH must fill before the PDF can generate.
 */
import type { PrismaClient } from '@prisma/client';
import { SKILLS } from './data-skills.js';

export const TEMPLATES = [
  {
    name: 'CDI standard',
    body: [
      'CONTRAT DE TRAVAIL A DUREE INDETERMINEE',
      '',
      "Entre la societe ESN Tunisie, ci-apres « l'Employeur »,",
      'et {{firstName}} {{lastName}}, ci-apres « le Salarie »,',
      'engage(e) au poste de {{position}} a compter du {{startDate}}.',
      '',
      'Type de contrat : {{type}}.',
      'Lieu de travail : {{lieuTravail}}.',
      'Remuneration annuelle brute : {{remunerationAnnuelle}} TND.',
      'Taux journalier de reference (TJM) : {{tjm}} TND.',
      "Periode d'essai : {{periodeEssai}}.",
      '',
      'Fait a Tunis, le {{startDate}}.',
    ].join('\n'),
  },
  {
    name: 'CDD standard',
    body: [
      'CONTRAT DE TRAVAIL A DUREE DETERMINEE',
      '',
      'Entre la societe ESN Tunisie et {{firstName}} {{lastName}},',
      'au poste de {{position}}, du {{startDate}} au {{endDate}}.',
      '',
      'Type de contrat : {{type}}.',
      'Motif de recours : {{motifRecours}}.',
      'Remuneration annuelle brute : {{remunerationAnnuelle}} TND.',
      'Taux journalier de reference (TJM) : {{tjm}} TND.',
      '',
      'Fait a Tunis, le {{startDate}}.',
    ].join('\n'),
  },
  {
    name: 'Contrat de prestation (Régie)',
    body: [
      'CONTRAT DE PRESTATION DE SERVICES (REGIE)',
      '',
      'Entre la societe ESN Tunisie et {{firstName}} {{lastName}},',
      'consultant(e) au poste de {{position}}, pour une mission',
      'debutant le {{startDate}} et se terminant le {{endDate}}.',
      '',
      'Type de contrat : {{type}}.',
      'Client final : {{nomClient}}.',
      'Taux journalier facture (TJM) : {{tjm}} TND.',
      '',
      'Fait a Tunis, le {{startDate}}.',
    ].join('\n'),
  },
] as const;

export interface ReferenceResult {
  /** skill name -> skill id, for the m2m connects done by later steps. */
  skillIds: Map<string, string>;
  templateIds: { cdi: string; cdd: string; regie: string };
}

export async function seedReference(prisma: PrismaClient): Promise<ReferenceResult> {
  const skillIds = new Map<string, string>();
  for (const skill of SKILLS) {
    const row = await prisma.skill.upsert({
      where: { name: skill.name },
      update: { category: skill.category },
      create: skill,
    });
    skillIds.set(row.name, row.id);
  }

  const templateIds: Record<string, string> = {};
  for (const tmpl of TEMPLATES) {
    const existing = await prisma.contractTemplate.findFirst({ where: { name: tmpl.name } });
    const row = existing
      ? await prisma.contractTemplate.update({
          where: { id: existing.id },
          data: { body: tmpl.body, isActive: true },
        })
      : await prisma.contractTemplate.create({ data: { ...tmpl, isActive: true } });
    templateIds[tmpl.name] = row.id;
  }

  const cdi = templateIds['CDI standard'];
  const cdd = templateIds['CDD standard'];
  const regie = templateIds['Contrat de prestation (Régie)'];
  if (!cdi || !cdd || !regie) throw new Error('Contract templates were not created');

  return { skillIds, templateIds: { cdi, cdd, regie } };
}
