import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/app-error.js';
import { validateAnswers } from './questions.validator.js';
import type { ActiveQuestion } from './questions.validator.js';

const q = (over: Partial<ActiveQuestion> & Pick<ActiveQuestion, 'key' | 'type'>): ActiveQuestion => ({
  label: over.key,
  required: false,
  ...over,
});

describe('validateAnswers', () => {
  it('rejects an unknown answer key', () => {
    expect(() => validateAnswers([q({ key: 'a', type: 'SHORT_TEXT' })], { b: 'x' })).toThrow(AppError);
  });

  it('rejects a missing required answer', () => {
    expect(() =>
      validateAnswers([q({ key: 'a', type: 'SHORT_TEXT', required: true })], {}),
    ).toThrow(AppError);
  });

  it('omits optional empty answers from the snapshot', () => {
    const snap = validateAnswers([q({ key: 'a', type: 'SHORT_TEXT' })], {});
    expect(snap).toEqual([]);
  });

  it('enforces SINGLE_CHOICE option membership', () => {
    const qs = [q({ key: 'lang', type: 'SINGLE_CHOICE', options: ['FR', 'EN'] })];
    expect(validateAnswers(qs, { lang: 'FR' })[0]).toMatchObject({ key: 'lang', value: 'FR' });
    expect(() => validateAnswers(qs, { lang: 'DE' })).toThrow(AppError);
  });

  it('enforces MULTI_CHOICE subset', () => {
    const qs = [q({ key: 'stack', type: 'MULTI_CHOICE', options: ['react', 'node', 'go'] })];
    expect(validateAnswers(qs, { stack: ['react', 'go'] })[0]?.value).toEqual(['react', 'go']);
    expect(() => validateAnswers(qs, { stack: ['react', 'rust'] })).toThrow(AppError);
  });

  it('coerces + bounds NUMBER', () => {
    const qs = [q({ key: 'yrs', type: 'NUMBER', config: { min: 0, max: 40 } })];
    expect(validateAnswers(qs, { yrs: '5' })[0]?.value).toBe(5);
    expect(() => validateAnswers(qs, { yrs: '99' })).toThrow(AppError);
    expect(() => validateAnswers(qs, { yrs: 'abc' })).toThrow(AppError);
  });

  it('requires a true BOOLEAN when required (acknowledgement)', () => {
    const qs = [q({ key: 'agree', type: 'BOOLEAN', required: true })];
    expect(validateAnswers(qs, { agree: 'true' })[0]?.value).toBe(true);
    expect(() => validateAnswers(qs, { agree: 'false' })).toThrow(AppError);
  });

  it('enforces text maxLength', () => {
    const qs = [q({ key: 'bio', type: 'SHORT_TEXT', config: { maxLength: 5 } })];
    expect(() => validateAnswers(qs, { bio: 'too long' })).toThrow(AppError);
  });
});
