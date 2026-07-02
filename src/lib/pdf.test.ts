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

  const base = { title: 'Contrat', body: 'Corps du contrat.' };

  it('appends a signature section (one block adds bytes)', async () => {
    const plain = await renderContractPdf(base);
    const oneSig = await renderContractPdf({
      ...base,
      signatures: [{ label: 'Consultant', name: 'Inès Chevalier', date: new Date('2026-07-02') }],
    });
    expect(oneSig.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(oneSig.length).toBeGreaterThan(plain.length);
  });

  it('renders both signatures without throwing (two blocks add more bytes)', async () => {
    const oneSig = await renderContractPdf({
      ...base,
      signatures: [{ label: 'Consultant', name: 'Inès Chevalier', date: new Date('2026-07-02') }],
    });
    const twoSig = await renderContractPdf({
      ...base,
      signatures: [
        { label: 'Consultant', name: 'Inès Chevalier', date: new Date('2026-07-02') },
        { label: 'ESN — Signataire', name: 'RH User', date: new Date('2026-07-03') },
      ],
    });
    expect(twoSig.length).toBeGreaterThan(oneSig.length);
  });
});
