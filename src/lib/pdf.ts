import PDFDocument from 'pdfkit';

/**
 * Generic, dependency-free (no Prisma/HTTP) PDF rendering helper.
 * Renders a simple A4 document with a heading and wrapped multi-line body.
 * Pure + unit-testable: collects pdfkit chunks into an in-memory Buffer.
 */
export interface RenderContractPdfInput {
  title: string;
  body: string;
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

    doc.end();
  });
}
