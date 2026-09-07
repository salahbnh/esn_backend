/**
 * Deterministic pseudo-random helpers for the seed.
 *
 * The dataset must be reproducible: two runs of `npm run seed:full` produce the
 * same people, the same staffing and the same numbers, so screenshots, tests and
 * bug reports stay comparable. `Math.random` cannot give that, so we use a small
 * mulberry32 generator with a fixed seed.
 */

export type Rng = () => number;

/** mulberry32 — tiny, fast, good enough for fixture data (NOT cryptographic). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of a non-empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const value = arr[Math.floor(rng() * arr.length)];
  if (value === undefined) {
    throw new Error('pick() called on an empty array');
  }
  return value;
}

/** `count` distinct elements (or the whole array if it is shorter). */
export function sample<T>(rng: Rng, arr: readonly T[], count: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i += 1) {
    const [item] = pool.splice(Math.floor(rng() * pool.length), 1);
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** True with probability `p` (0..1). */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The anchor every relative date is computed from — midnight UTC of the day the
 * seed runs.
 *
 * Relative dates are the right default: they keep "missions en cours" actually
 * in progress and the dashboards current, whenever the seed is run. Set
 * `SEED_ANCHOR_DATE=YYYY-MM-DD` to freeze the anchor instead, which reproduces a
 * previous run's dates exactly — useful when a second machine must hold a
 * byte-for-byte copy of an existing dataset.
 */
function resolveAnchor(): Date {
  const pinned = process.env['SEED_ANCHOR_DATE'];
  if (pinned !== undefined && pinned !== '') {
    const parsed = new Date(`${pinned}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`SEED_ANCHOR_DATE must be YYYY-MM-DD, received "${pinned}"`);
    }
    return parsed;
  }
  return new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
}

export const TODAY = resolveAnchor();

/** Date shifted by `days` from today (negative = past). */
export function days(offset: number): Date {
  return new Date(TODAY.getTime() + offset * DAY_MS);
}

/** Date shifted by roughly `months` from today. */
export function months(offset: number): Date {
  const d = new Date(TODAY.getTime());
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d;
}

/** Random date between two day-offsets from today. */
export function dateBetween(rng: Rng, fromOffset: number, toOffset: number): Date {
  return days(int(rng, fromOffset, toOffset));
}

/** ISO yyyy-mm-dd (what the contract templates render). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** dd/mm/yyyy — the French display format used inside generated documents. */
export function frDay(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getUTCFullYear()}`;
}
