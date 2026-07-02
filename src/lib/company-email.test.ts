import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import {
  applyEmailSuffix,
  generateBaseEmail,
  generateLocalPart,
  slugifyNamePart,
} from './company-email.js';

const DOMAIN = 'esn.local';

describe('slugifyNamePart', () => {
  it('lowercases plain ASCII', () => {
    expect(slugifyNamePart('Jean')).toBe('jean');
  });

  it('strips diacritics', () => {
    expect(slugifyNamePart('François')).toBe('francois');
    expect(slugifyNamePart('María')).toBe('maria');
    expect(slugifyNamePart('Müller')).toBe('muller');
  });

  it('removes hyphens, apostrophes and spaces', () => {
    expect(slugifyNamePart('Jean-Pierre')).toBe('jeanpierre');
    expect(slugifyNamePart("O'Brien")).toBe('obrien');
    expect(slugifyNamePart('Jean Marie')).toBe('jeanmarie');
  });

  it('returns empty for a name with no Latin/numeric characters', () => {
    expect(slugifyNamePart('李')).toBe('');
  });
});

describe('generateBaseEmail', () => {
  it('builds prenom.nom@domain for ASCII names', () => {
    expect(generateBaseEmail('Jean', 'Dupont', DOMAIN)).toBe('jean.dupont@esn.local');
  });

  it('normalises accents in both parts', () => {
    expect(generateBaseEmail('François', 'Müller', DOMAIN)).toBe('francois.muller@esn.local');
  });

  it('collapses a hyphenated first name', () => {
    expect(generateBaseEmail('Jean-Pierre', 'Martin', DOMAIN)).toBe('jeanpierre.martin@esn.local');
  });

  it('drops an apostrophe', () => {
    expect(generateBaseEmail("O'Brien", 'Smith', DOMAIN)).toBe('obrien.smith@esn.local');
  });

  it('honours a custom domain', () => {
    expect(generateBaseEmail('Jean', 'Dupont', 'acme.io')).toBe('jean.dupont@acme.io');
  });
});

describe('generateLocalPart', () => {
  it('throws AppError when the first name slugifies to empty', () => {
    expect(() => generateLocalPart('李', 'Dupont')).toThrow(AppError);
  });

  it('throws AppError when the last name slugifies to empty', () => {
    expect(() => generateLocalPart('Jean', '。')).toThrow(AppError);
  });
});

describe('applyEmailSuffix', () => {
  it('inserts a single-digit suffix before the @', () => {
    expect(applyEmailSuffix('jean.dupont@esn.local', 2)).toBe('jean.dupont2@esn.local');
  });

  it('inserts a multi-digit suffix', () => {
    expect(applyEmailSuffix('jean.dupont@esn.local', 10)).toBe('jean.dupont10@esn.local');
  });
});
