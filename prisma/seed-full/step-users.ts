/**
 * Staff accounts: RH, MANAGER and DIRECTION.
 *
 * The four addresses shipped in `keycloak/realm-export.json`
 * (rh@ / manager@ / direction@ / consultant@esn.local) are KEPT as logins — they
 * are what every doc and README tells you to sign in with — but their display
 * names are re-pointed to the Tunisian identities used throughout the dataset,
 * in Keycloak and in the DB, so no "Rita RH" leaks into the UI.
 *
 * One RH is seeded deactivated (`isActive: false` + a disabled Keycloak account)
 * so the /users admin screen has a reactivation case to show.
 */
import type { PrismaClient, Role, User } from '@prisma/client';
import { sid } from './ids.js';
import { ensureKeycloakUser } from './keycloak.js';
import { months } from './rng.js';

export interface StaffSeed {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
}

export const STAFF: readonly StaffSeed[] = [
  // --- the documented dev logins, re-identified ---
  { key: 'rh1', email: 'rh@esn.local', firstName: 'Sonia', lastName: 'Ben Ammar', role: 'RH', isActive: true },
  { key: 'mgr1', email: 'manager@esn.local', firstName: 'Karim', lastName: 'Trabelsi', role: 'MANAGER', isActive: true },
  { key: 'dir1', email: 'direction@esn.local', firstName: 'Mehdi', lastName: 'Bouazizi', role: 'DIRECTION', isActive: true },
  // --- additional staff, so authorship and validation are not all one person ---
  { key: 'rh2', email: 'amira.bensaid@esn.local', firstName: 'Amira', lastName: 'Ben Said', role: 'RH', isActive: true },
  { key: 'rh3', email: 'hedi.zouari@esn.local', firstName: 'Hedi', lastName: 'Zouari', role: 'RH', isActive: false },
  { key: 'mgr2', email: 'nadia.gharbi@esn.local', firstName: 'Nadia', lastName: 'Gharbi', role: 'MANAGER', isActive: true },
  { key: 'mgr3', email: 'slim.mansouri@esn.local', firstName: 'Slim', lastName: 'Mansouri', role: 'MANAGER', isActive: true },
  { key: 'dir2', email: 'leila.chaabane@esn.local', firstName: 'Leila', lastName: 'Chaabane', role: 'DIRECTION', isActive: true },
];

export type StaffMap = Map<string, User>;

export async function seedStaff(prisma: PrismaClient): Promise<StaffMap> {
  const staff: StaffMap = new Map();

  for (const person of STAFF) {
    const keycloakId = await ensureKeycloakUser({
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      realmRole: person.role,
      enabled: person.isActive,
    });

    const user = await prisma.user.create({
      data: {
        id: sid(`user-staff-${person.key}`),
        keycloakId,
        email: person.email,
        firstName: person.firstName,
        lastName: person.lastName,
        role: person.role,
        isActive: person.isActive,
        // Staff predate the operational data so they can author it credibly.
        createdAt: months(-30),
      },
    });
    staff.set(person.key, user);
  }

  return staff;
}

/** Narrow lookup that throws instead of returning undefined (strict mode). */
export function staffOf(staff: StaffMap, key: string): User {
  const user = staff.get(key);
  if (!user) throw new Error(`Seed staff "${key}" was not created`);
  return user;
}
