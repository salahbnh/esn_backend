/**
 * AI evaluations of applications against their job post.
 *
 * These rows are HAND-WRITTEN, not produced by a live Claude call: the seed must
 * run without an ANTHROPIC_API_KEY, be deterministic, and cost nothing. They are
 * shaped exactly like a real run — `model` and `promptVersion` record which
 * prompt produced them, `score` stays inside the band its `verdict` implies, and
 * token counts are plausible — so the card, the score ring and the history
 * accordion render as they would in production.
 *
 * Two applications carry TWO runs, which is what "Reevaluer" appends: an early
 * form-only pass (`cvUsed: false`) followed by a run that also read the CV.
 */
import type { AiVerdict, Prisma, PrismaClient } from '@prisma/client';
import { sid, n2 } from './ids.js';
import { days, int, type Rng } from './rng.js';
import type { SeededApplication } from './step-applications.js';
import { staffOf, type StaffMap } from './step-users.js';

const MODEL = 'claude-haiku-4-5';
const PROMPT_VERSION = 'v1';

interface EvalTemplate {
  verdict: AiVerdict;
  score: number;
  strengths: string[];
  gaps: string[];
  reasoning: string;
}

const TEMPLATES: readonly EvalTemplate[] = [
  {
    verdict: 'STRONG_MATCH',
    score: 92,
    strengths: [
      "Experience directement alignee avec le poste (meme stack, meme secteur)",
      'Anciennete superieure au minimum demande',
      'Disponibilite immediate declaree',
    ],
    gaps: ["Pas de certification cloud mentionnee, ce qui reste secondaire pour ce poste"],
    reasoning:
      "Le profil correspond tres precisement au besoin : la stack declaree recouvre l'integralite des technologies citees dans l'offre, et l'anciennete annoncee depasse le minimum requis. Les reponses au questionnaire montrent une bonne comprehension du contexte ESN (regie, relation client). Aucun ecart bloquant identifie ; le seul point d'attention porte sur l'absence de certification, non exigee par l'offre. Recommandation : passer directement a l'entretien technique.",
  },
  {
    verdict: 'STRONG_MATCH',
    score: 88,
    strengths: [
      'Maitrise confirmee des technologies principales de l\'offre',
      'Experience en environnement client exigeant',
      'Bon niveau de redaction dans les reponses libres',
    ],
    gaps: ['Preavis de 3 mois, a arbitrer avec la date de demarrage souhaitee par le client'],
    reasoning:
      "Candidature solide : les competences declarees couvrent le coeur du besoin et le parcours decrit une progression coherente. Le seul frein est calendaire — le preavis annonce depasse la fenetre de demarrage indiquee dans l'offre. A qualifier avec le client avant de poursuivre.",
  },
  {
    verdict: 'GOOD_MATCH',
    score: 78,
    strengths: [
      'Socle technique conforme au perimetre principal',
      'Experience sectorielle transposable',
    ],
    gaps: [
      "Une des technologies secondaires de l'offre n'apparait pas dans le dossier",
      "Nombre d'annees d'experience legerement inferieur au seuil affiche",
    ],
    reasoning:
      "Bon candidat sur le fond : le socle technique principal est acquis et le secteur d'intervention est proche de celui du client. Deux ecarts mineurs subsistent — une technologie secondaire non citee et une anciennete un peu courte face au minimum affiche. Ces points sont rattrapables par un accompagnement en debut de mission. A recevoir en entretien.",
  },
  {
    verdict: 'GOOD_MATCH',
    score: 73,
    strengths: ['Competences principales presentes', 'Motivation clairement exprimee'],
    gaps: ["Peu d'elements sur la mise en production", 'Anglais professionnel non evalue'],
    reasoning:
      "Le dossier couvre l'essentiel du besoin mais reste peu detaille sur les phases d'industrialisation et de mise en production, qui pesent lourd sur cette mission. La motivation est explicite et le parcours coherent. Un entretien technique permettrait de lever le doute sur l'experience reelle en production.",
  },
  {
    verdict: 'PARTIAL_MATCH',
    score: 61,
    strengths: ['Bases techniques saines', 'Profil junior mais progression rapide'],
    gaps: [
      "Experience nettement inferieure au minimum demande par l'offre",
      'Aucune experience du secteur vise',
      'Pas de pratique des outils cites en pre-requis',
    ],
    reasoning:
      "Profil interessant mais decale par rapport a cette offre precise : le niveau d'experience est en dessous du seuil, et les pre-requis outils ne sont pas couverts. Les fondamentaux sont la, ce qui rend le candidat pertinent pour une offre plus junior du portefeuille plutot que pour ce poste. A rediriger.",
  },
  {
    verdict: 'PARTIAL_MATCH',
    score: 55,
    strengths: ['Une des competences cles est bien maitrisee'],
    gaps: [
      'Le reste de la stack demandee est absent du dossier',
      'Reponses au questionnaire tres succinctes',
      'Disponibilite non precisee',
    ],
    reasoning:
      "Correspondance partielle : un seul axe de l'offre est reellement couvert, le reste n'est pas documente. Les reponses libres sont trop courtes pour statuer sur le niveau reel. Un echange telephonique de qualification est necessaire avant toute decision.",
  },
  {
    verdict: 'WEAK_MATCH',
    score: 34,
    strengths: ["Formation initiale en informatique"],
    gaps: [
      "Aucune des technologies principales de l'offre n'est mentionnee",
      'Experience sans rapport avec le poste',
      "Attentes salariales hors de la fourchette du poste",
    ],
    reasoning:
      "Le dossier ne recoupe pas le besoin : ni la stack, ni le domaine d'intervention, ni le niveau attendu ne correspondent a l'offre. La formation initiale est le seul point commun. Cette candidature releve d'une reorientation vers d'autres offres du portefeuille, ou d'un refus argumente.",
  },
  {
    verdict: 'WEAK_MATCH',
    score: 27,
    strengths: [],
    gaps: [
      "Contenu de la candidature sans rapport avec l'offre",
      'Aucune competence technique exploitable declaree',
    ],
    reasoning:
      "La candidature ne contient aucun element permettant d'evaluer une adequation avec le poste. Ni les competences declarees ni les reponses au questionnaire ne se rapportent au perimetre de l'offre. A ecarter.",
  },
];

export async function seedAiEvaluations(
  prisma: PrismaClient,
  rng: Rng,
  staff: StaffMap,
  applications: SeededApplication[],
): Promise<number> {
  // Evaluate the applications RH would actually have run the assistant on:
  // real candidatures (never SPAM), oldest-reviewed first.
  const evaluable = applications.filter((a) => a.status !== 'SPAM').slice(0, 14);
  let created = 0;

  for (const [index, app] of evaluable.entries()) {
    const template = TEMPLATES[index % TEMPLATES.length];
    if (!template) continue;
    const author = staffOf(staff, index % 2 === 0 ? 'rh1' : 'rh2');
    const runAt = new Date(Math.max(app.createdAt.getTime() + 86_400_000, days(-int(rng, 1, 25)).getTime()));

    created += 1;
    await prisma.aiEvaluation.create({
      data: {
        id: sid(`aieval-${n2(created)}`),
        applicationId: app.id,
        score: template.score,
        verdict: template.verdict,
        strengths: template.strengths as unknown as Prisma.InputJsonValue,
        gaps: template.gaps as unknown as Prisma.InputJsonValue,
        reasoning: template.reasoning,
        cvUsed: true,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        tokensInput: int(rng, 2400, 5200),
        tokensOutput: int(rng, 280, 620),
        createdById: author.id,
        createdAt: runAt,
      },
    });

    // Two dossiers keep a re-evaluation history: an earlier form-only pass that
    // scored lower because the CV had not been attached yet.
    if (index === 0 || index === 3) {
      created += 1;
      await prisma.aiEvaluation.create({
        data: {
          id: sid(`aieval-${n2(created)}`),
          applicationId: app.id,
          score: Math.max(10, template.score - int(rng, 9, 18)),
          verdict: template.verdict === 'STRONG_MATCH' ? 'GOOD_MATCH' : 'PARTIAL_MATCH',
          strengths: template.strengths.slice(0, 1) as unknown as Prisma.InputJsonValue,
          gaps: [
            ...template.gaps,
            'CV non fourni au moment de cette evaluation : analyse basee sur le formulaire seul',
          ] as unknown as Prisma.InputJsonValue,
          reasoning:
            "Premiere passe realisee avant reception du CV : l'evaluation ne s'appuie que sur le formulaire de candidature. Les elements declares sont coherents avec l'offre mais insuffisamment etayes pour conclure. Une reevaluation apres depot du CV est recommandee.",
          cvUsed: false,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          tokensInput: int(rng, 900, 1600),
          tokensOutput: int(rng, 200, 400),
          createdById: author.id,
          createdAt: new Date(runAt.getTime() - 3 * 86_400_000),
        },
      });
    }
  }

  return created;
}
