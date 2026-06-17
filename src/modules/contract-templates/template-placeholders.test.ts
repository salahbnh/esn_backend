import { describe, expect, it } from 'vitest';
import { parseTemplatePlaceholders } from './template-placeholders.js';

describe('parseTemplatePlaceholders', () => {
  it('extracts placeholders in first-seen order', () => {
    const result = parseTemplatePlaceholders('{{type}} for {{firstName}} {{lastName}}');
    expect(result.map((p) => p.name)).toEqual(['type', 'firstName', 'lastName']);
  });

  it('deduplicates repeated placeholders, keeping first-seen order', () => {
    const result = parseTemplatePlaceholders('{{firstName}} {{salary}} {{firstName}} {{salary}}');
    expect(result.map((p) => p.name)).toEqual(['firstName', 'salary']);
  });

  it('tags AUTO placeholders as auto and the rest as manual', () => {
    const result = parseTemplatePlaceholders(
      '{{firstName}} {{position}} {{tjm}} {{salary}} {{office}}',
    );
    expect(result).toEqual([
      { name: 'firstName', source: 'auto' },
      { name: 'position', source: 'auto' },
      { name: 'tjm', source: 'auto' },
      { name: 'salary', source: 'manual' },
      { name: 'office', source: 'manual' },
    ]);
  });

  it('trims whitespace inside the braces', () => {
    const result = parseTemplatePlaceholders('{{  firstName  }} and {{ salary }}');
    expect(result).toEqual([
      { name: 'firstName', source: 'auto' },
      { name: 'salary', source: 'manual' },
    ]);
  });

  it('returns [] when there are no placeholders', () => {
    expect(parseTemplatePlaceholders('Plain text, no tokens here.')).toEqual([]);
    expect(parseTemplatePlaceholders('')).toEqual([]);
  });
});
