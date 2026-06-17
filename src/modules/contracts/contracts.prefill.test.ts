import { describe, expect, it } from 'vitest';
import { buildPrefillData } from './contracts.prefill.js';

const consultant = {
  user: { firstName: 'Ada', lastName: 'Lovelace' },
  position: 'Senior Engineer',
  tjm: '500.00' as string | null,
};

describe('buildPrefillData', () => {
  it('substitutes all known auto placeholders correctly', () => {
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
    expect(result.unfilled).toEqual([]);
  });

  it('leaves a placeholder with a null/empty auto value unfilled', () => {
    const result = buildPrefillData({
      template: { body: 'rate={{tjm}}.' },
      consultant: { ...consultant, tjm: null },
      overrides: { type: 'CDD' },
    });
    expect(result.fields.tjm).toBe('');
    // Empty value is NOT substituted — the placeholder stays + is reported.
    expect(result.renderedBody).toBe('rate={{tjm}}.');
    expect(result.unfilled).toEqual(['tjm']);
  });

  it('reports missing optional dates as unfilled', () => {
    const result = buildPrefillData({
      template: { body: 's={{startDate}};e={{endDate}}' },
      consultant,
      overrides: { type: 'CDI' },
    });
    expect(result.renderedBody).toBe('s={{startDate}};e={{endDate}}');
    expect(result.unfilled).toEqual(['startDate', 'endDate']);
  });

  it('returns empty renderedBody and no unfilled when there is no template', () => {
    const result = buildPrefillData({
      template: null,
      consultant,
      overrides: { type: 'CDI' },
    });
    expect(result.renderedBody).toBe('');
    expect(result.unfilled).toEqual([]);
    expect(result.fields.firstName).toBe('Ada');
  });

  it('merges RH manual fields and substitutes them', () => {
    const result = buildPrefillData({
      template: { body: '{{firstName}} earns {{salary}} at {{office}}' },
      consultant,
      overrides: { type: 'CDI' },
      fields: { salary: '60000', office: 'Paris' },
    });
    expect(result.renderedBody).toBe('Ada earns 60000 at Paris');
    expect(result.fields.salary).toBe('60000');
    expect(result.unfilled).toEqual([]);
  });

  it('detects manual placeholders left unfilled', () => {
    const result = buildPrefillData({
      template: { body: '{{firstName}} — {{salary}} — {{office}}' },
      consultant,
      overrides: { type: 'CDI' },
      fields: { salary: '60000' },
    });
    expect(result.renderedBody).toBe('Ada — 60000 — {{office}}');
    expect(result.unfilled).toEqual(['office']);
  });

  it('AUTO fields cannot be overridden by a colliding RH manual key (auto wins)', () => {
    const result = buildPrefillData({
      template: { body: '{{firstName}} {{position}}' },
      consultant,
      overrides: { type: 'CDI' },
      fields: { firstName: 'Hacker', position: 'CEO' },
    });
    expect(result.renderedBody).toBe('Ada Senior Engineer');
    expect(result.fields.firstName).toBe('Ada');
    expect(result.fields.position).toBe('Senior Engineer');
  });
});
