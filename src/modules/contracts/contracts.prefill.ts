/**
 * Pure prefill/render logic for contracts. NO Prisma, NO HTTP — unit-testable in
 * isolation. Substitutes `{{placeholders}}` in the template body with consultant
 * + contract data. Unknown `{{x}}` placeholders are left untouched. A null tjm
 * renders as the empty string. With no template, `renderedBody` is empty.
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
}

export interface PrefillResult {
  fields: Record<string, string>;
  renderedBody: string;
}

export function buildPrefillData(input: PrefillInput): PrefillResult {
  const { template, consultant, overrides } = input;

  const fields: Record<string, string> = {
    firstName: consultant.user.firstName,
    lastName: consultant.user.lastName,
    position: consultant.position,
    tjm: consultant.tjm ?? '',
    startDate: overrides.startDate ?? '',
    endDate: overrides.endDate ?? '',
    type: overrides.type,
  };

  // No template → nothing to render. Snapshot the fields only.
  if (!template) {
    return { fields, renderedBody: '' };
  }

  // Replace only known placeholders; unknown `{{x}}` are left as-is.
  const renderedBody = template.body.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(fields, key) ? fields[key]! : match,
  );

  return { fields, renderedBody };
}
