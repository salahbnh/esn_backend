import {
  AUTO_PLACEHOLDERS,
  parseTemplatePlaceholders,
} from '../contract-templates/template-placeholders.js';

/**
 * Pure prefill/render logic for contracts. NO Prisma, NO HTTP — unit-testable in
 * isolation. Substitutes `{{placeholders}}` in the template body with a merge of
 * AUTO fields (derived from the consultant/contract) and MANUAL `fields` (entered
 * by RH). AUTO keys always win on collision. A null tjm renders as the empty
 * string. With no template, `renderedBody` is empty and nothing is unfilled.
 */

export interface PrefillTemplate {
  body: string;
}

export interface PrefillConsultant {
  user: { firstName: string; lastName: string };
  position: string;
  tjm: string | null;
}

export interface PrefillOverrides {
  startDate?: string;
  endDate?: string;
  type: string;
}

export interface PrefillInput {
  template: PrefillTemplate | null;
  consultant: PrefillConsultant;
  overrides: PrefillOverrides;
  /** RH-entered manual placeholder values (placeholder name -> value). */
  fields?: Record<string, string>;
}

export interface PrefillResult {
  fields: Record<string, string>;
  renderedBody: string;
  /** Template placeholders that remain without a (non-empty) value. */
  unfilled: string[];
}

const AUTO_KEYS: ReadonlySet<string> = new Set(AUTO_PLACEHOLDERS);

export function buildPrefillData(input: PrefillInput): PrefillResult {
  const { template, consultant, overrides, fields: manualFields } = input;

  const autoFields: Record<string, string> = {
    firstName: consultant.user.firstName,
    lastName: consultant.user.lastName,
    position: consultant.position,
    tjm: consultant.tjm ?? '',
    startDate: overrides.startDate ?? '',
    endDate: overrides.endDate ?? '',
    type: overrides.type,
  };

  // Merge: RH manual values are the base; AUTO keys always override so RH can
  // never spoof a system-derived field via a colliding manual key.
  const merged: Record<string, string> = { ...(manualFields ?? {}) };
  for (const key of AUTO_KEYS) {
    merged[key] = autoFields[key]!;
  }

  // No template → nothing to render. Snapshot the merged fields only.
  if (!template) {
    return { fields: merged, renderedBody: '', unfilled: [] };
  }

  // Replace only placeholders with a non-empty value; unknown/empty `{{x}}` are
  // left as-is and reported as unfilled.
  const renderedBody = template.body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, raw: string) => {
    const key = raw.trim();
    const value = merged[key];
    return value !== undefined && value !== '' ? value : match;
  });

  const placeholders = parseTemplatePlaceholders(template.body);
  const unfilled = placeholders
    .filter((p) => {
      const value = merged[p.name];
      return value === undefined || value === '';
    })
    .map((p) => p.name);

  return { fields: merged, renderedBody, unfilled };
}
