import { describe, expect, it } from 'vitest';
import { buildPrefillData } from './contracts.prefill.js';

const consultant = {
  user: { firstName: 'Ada', lastName: 'Lovelace' },
  position: 'Senior Engineer',
  tjm: '500.00' as string | null,
};

describe('buildPrefillData', () => {
  it('substitutes all known placeholders correctly', () => {
    const result = buildPrefillData({
      template: {
        body: '{{firstName}} {{lastName}} — {{position}} @ {{tjm}}/day, {{type}} from {{startDate}} to {{endDate}}',
      },
      consultant,
      overrides: { startDate: '2026-07-01', endDate: '2027-07-01', type: 'CDI' },
    });
    expect(result.renderedBody).toBe(
      'Ada Lovelace — Senior Engineer @ 500.00/day, CDI from 2026-07-01 to 2027-07-01',
    );
    expect(result.fields).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      position: 'Senior Engineer',
      tjm: '500.00',
      type: 'CDI',
    });
  });

  it('renders empty string for a null tjm', () => {
    const result = buildPrefillData({
      template: { body: 'rate={{tjm}}.' },
      consultant: { ...consultant, tjm: null },
      overrides: { type: 'CDD' },
    });
    expect(result.fields.tjm).toBe('');
    expect(result.renderedBody).toBe('rate=.');
  });

  it('renders empty strings for missing optional dates', () => {
    const result = buildPrefillData({
      template: { body: 's={{startDate}};e={{endDate}}' },
      consultant,
      overrides: { type: 'CDI' },
    });
    expect(result.renderedBody).toBe('s=;e=');
    expect(result.fields.startDate).toBe('');
    expect(result.fields.endDate).toBe('');
  });

  it('returns empty renderedBody when there is no template', () => {
    const result = buildPrefillData({
      template: null,
      consultant,
      overrides: { type: 'CDI' },
    });
    expect(result.renderedBody).toBe('');
    expect(result.fields.firstName).toBe('Ada');
  });

  it('leaves unknown placeholders untouched', () => {
    const result = buildPrefillData({
      template: { body: '{{firstName}} {{unknownKey}} {{salary}}' },
      consultant,
      overrides: { type: 'CDI' },
    });
    expect(result.renderedBody).toBe('Ada {{unknownKey}} {{salary}}');
  });
});
