import PDFDocument from 'pdfkit';

/**
 * Generic, dependency-free (no Prisma/HTTP) PDF rendering helper.
 * Renders a simple A4 document with a heading, wrapped multi-line body, and an
 * optional signatures section. Pure + unit-testable: collects pdfkit chunks into
 * an in-memory Buffer.
 *
 * Signatures are re-rendered from the contract body at sign/countersign time
 * (pdfkit cannot read an existing PDF to append to it). This is an in-app
 * acknowledgment stamp, not a qualified electronic signature.
 */
export interface SignatureBlock {
  label: string; // e.g. "Consultant" | "ESN — Signataire"
  name: string;
  date: Date;
}

export interface RenderContractPdfInput {
  title: string;
  body: string;
  signatures?: SignatureBlock[];
}

function formatDate(date: Date): string {
  // Deterministic dd/mm/yyyy — avoids locale drift in tests.
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

export function renderContractPdf(input: RenderContractPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(input.title, { align: 'left' });
    doc.moveDown();
    doc.fontSize(12).text(input.body, { align: 'left' });

    const signatures = input.signatures ?? [];
    if (signatures.length > 0) {
      doc.moveDown(2);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown();
      doc.fontSize(14).text('SIGNATURES', { align: 'left' });
      doc.moveDown(0.5);
      for (const s of signatures) {
        doc.fontSize(12).text(`${s.label} — ${s.name} — le ${formatDate(s.date)}`, {
          align: 'left',
        });
        doc.moveDown(0.5);
      }
    }

    doc.end();
  });
}
