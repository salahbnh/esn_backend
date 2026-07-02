import { AppError } from './app-error.js';

/**
 * Company-email generation for consultant onboarding.
 *
 * When a candidate is converted to a consultant we mint an internal identity
 * `prenom.nom@domain` (e.g. jean.dupont@esn.local) — consistent with the other
 * internal users — instead of reusing the candidate's personal recruitment email.
 * The personal email stays on the Candidate record.
 *
 * These are pure string helpers (no I/O). Collision resolution against the DB /
 * Keycloak lives in the conversion service, which composes these with a suffix.
 */

/**
 * Normalises a single name part to an email-safe token:
 * strips diacritics, lowercases, and drops every non `[a-z0-9]` character.
 *   "Jean-Pierre" -> "jeanpierre"   "François" -> "francois"
 *   "O'Brien"     -> "obrien"        "María"    -> "maria"
 */
export function slugifyNamePart(name: string): string {
  return name
    .normalize('NFD') // split accented chars into base + combining mark
    .replace(/\p{M}/gu, '') // remove the combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // keep only ascii letters + digits
}

/**
 * Builds the local-part `slug(first).slug(last)`.
 * Throws if either part is empty after slugification (e.g. a name with no Latin
 * characters), so the caller surfaces a clear error rather than an invalid email.
 */
export function generateLocalPart(firstName: string, lastName: string): string {
  const first = slugifyNamePart(firstName);
  const last = slugifyNamePart(lastName);
  if (!first || !last) {
    throw AppError.internal(
      'Could not derive a company email from the candidate name; provide a Latin-character name',
    );
  }
  return `${first}.${last}`;
}

/** Assembles the base company email `{localPart}@{domain}`. */
export function generateBaseEmail(
  firstName: string,
  lastName: string,
  domain: string,
): string {
  return `${generateLocalPart(firstName, lastName)}@${domain}`;
}

/**
 * Inserts a numeric suffix before the `@` for collision resolution:
 *   ("jean.dupont@esn.local", 2) -> "jean.dupont2@esn.local"
 */
export function applyEmailSuffix(base: string, suffix: number): string {
  const at = base.indexOf('@');
  if (at === -1) {
    // Defensive: base is always produced by generateBaseEmail, so this is unreachable.
    throw AppError.internal('Malformed base email while applying suffix');
  }
  return `${base.slice(0, at)}${suffix}${base.slice(at)}`;
}
