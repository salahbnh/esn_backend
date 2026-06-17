/**
 * Pure placeholder introspection for contract templates. NO Prisma, NO HTTP —
 * unit-testable in isolation. Extracts unique `{{name}}` tokens from a template
 * body and tags each as `auto` (system-derived from the consultant/contract) or
 * `manual` (an RH-entered value).
 */

/** Placeholders the system derives automatically; everything else is manual. */
export const AUTO_PLACEHOLDERS = [
  'firstName',
  'lastName',
  'position',
  'tjm',
  'startDate',
  'endDate',
  'type',
] as const;

export type PlaceholderSource = 'auto' | 'manual';

export interface TemplatePlaceholder {
  name: string;
  source: PlaceholderSource;
}

const AUTO_SET: ReadonlySet<string> = new Set(AUTO_PLACEHOLDERS);

/**
 * Extract unique `{{name}}` tokens (trimmed) in first-seen order. Each token is
 * tagged `auto` when in AUTO_PLACEHOLDERS, else `manual`. A body with no tokens
 * returns `[]`.
 */
export function parseTemplatePlaceholders(body: string): TemplatePlaceholder[] {
  const result: TemplatePlaceholder[] = [];
  const seen = new Set<string>();
  const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const name = match[1]!.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({ name, source: AUTO_SET.has(name) ? 'auto' : 'manual' });
  }
  return result;
}
