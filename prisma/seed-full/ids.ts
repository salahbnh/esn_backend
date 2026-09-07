/**
 * Stable, cuid-shaped ids for seeded rows.
 *
 * The API validates every `/:id` path param with `z.string().cuid()`
 * (`/^c[^\s-]{8,}$/i`), so fixture ids must start with `c` and contain no
 * hyphens or whitespace — otherwise a seeded record 404s on its own detail page
 * while an API-created one works. Deriving the id from a readable slug keeps the
 * seed idempotent (upsert on a known id) and makes the data greppable.
 *
 *   sid('consultant-04') -> 'cconsultant04'
 */
export function sid(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9]/g, '');
  const id = `c${cleaned}`;
  if (id.length < 9) {
    throw new Error(`Seed id "${id}" is too short for cuid validation (min 9 chars): ${slug}`);
  }
  return id;
}

/** Zero-padded index helper: `n(3)` -> '03'. */
export function n2(index: number): string {
  return String(index).padStart(2, '0');
}
