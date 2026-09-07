/**
 * Consultant identities + profiles.
 *
 * Each consultant gets a real Keycloak account and a `prenom.nom@esn.local`
 * company address built with the app's own `generateBaseEmail` — the same
 * identity the conversion flow would mint — so logging in as a consultant shows
 * exactly what a real hire would see. The six converted profiles keep a
 * `candidateId` back-reference to the HIRED candidate they came from.
 */
import type { PrismaClient } from '@prisma/client';
import { config } from '../../src/config/env.js';
import { generateBaseEmail } from '../../src/lib/company-email.js';
import { CONSULTANTS, TJM_BANDS, type ConsultantSeed } from './data-consultants.js';
import { SKILL_PROFILES } from './data-skills.js';
import { CITIES } from './data-names.js';
import { sid } from './ids.js';
import { ensureKeycloakUser } from './keycloak.js';
import { type Rng, days, int, months, pick, sample } from './rng.js';

export interface SeededConsultant {
  seed: ConsultantSeed;
  id: string;
  userId: string;
  email: string;
  tjm: number;
  hireDate: Date;
  city: string;
  skills: string[];
}

export async function seedConsultants(
  prisma: PrismaClient,
  rng: Rng,
  skillIds: Map<string, string>,
  candidateIds: Map<string, string>,
): Promise<Map<string, SeededConsultant>> {
  const out = new Map<string, SeededConsultant>();
  const usedEmails = new Set<string>();

  for (const c of CONSULTANTS) {
    // Company identity: explicit for the shipped dev login, generated otherwise.
    let email = c.emailOverride ?? generateBaseEmail(c.firstName, c.lastName, config.COMPANY_EMAIL_DOMAIN);
    if (usedEmails.has(email)) {
      // Same collision rule as the conversion service: append a numeric suffix.
      let suffix = 2;
      const [local, domain] = email.split('@');
      while (usedEmails.has(`${local}${suffix}@${domain}`)) suffix += 1;
      email = `${local}${suffix}@${domain}`;
    }
    usedEmails.add(email);

    const keycloakId = await ensureKeycloakUser({
      email,
      firstName: c.firstName,
      lastName: c.lastName,
      realmRole: 'CONSULTANT',
    });

    const hireDate = months(-c.tenureMonths);
    const userId = sid(`user-cons-${c.key}`);
    await prisma.user.create({
      data: {
        id: userId,
        keycloakId,
        email,
        firstName: c.firstName,
        lastName: c.lastName,
        role: 'CONSULTANT',
        isActive: true,
        createdAt: hireDate,
      },
    });

    const band = TJM_BANDS[c.seniority];
    const tjm = int(rng, band[0], band[1]);
    const skillNames = sample(rng, SKILL_PROFILES[c.profile] ?? [], int(rng, 4, 5));
    const city = pick(rng, CITIES);

    const id = sid(`consultant-${c.key}`);
    await prisma.consultant.create({
      data: {
        id,
        userId,
        position: c.position,
        tjm: tjm.toFixed(2),
        status: c.status,
        hireDate,
        // Availability only means something off-mission; an ON_MISSION profile
        // is freed by its assignment end date, not by a field.
        availabilityDate:
          c.status === 'ON_MISSION'
            ? null
            : c.status === 'INTERCONTRAT'
              ? days(int(rng, 5, 45))
              : days(int(rng, -45, -1)),
        seniority: c.seniority,
        bio: `${c.position} ${c.seniority.toLowerCase()} base(e) a ${city}. ${c.tenureMonths} mois d'anciennete au sein de l'ESN, intervenu(e) sur des projets ${c.profile === 'management' ? 'de pilotage' : 'techniques'} pour des clients grands comptes tunisiens.`,
        candidateId: c.fromCandidate ? (candidateIds.get(c.fromCandidate) ?? null) : null,
        createdAt: hireDate,
        skills: {
          connect: skillNames
            .map((name) => skillIds.get(name))
            .filter((skillId): skillId is string => skillId !== undefined)
            .map((skillId) => ({ id: skillId })),
        },
      },
    });

    out.set(c.key, { seed: c, id, userId, email, tjm, hireDate, city, skills: skillNames });
  }

  return out;
}
