import { describe, expect, it } from 'vitest';
import { renderContractPdf } from './pdf.js';

describe('renderContractPdf', () => {
  it('returns a non-empty Buffer starting with the %PDF magic bytes', async () => {
    const buf = await renderContractPdf({
      title: 'Contrat de prestation',
      body: 'Ligne 1\nLigne 2\nUn corps de texte plus long qui doit être enveloppé.',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
