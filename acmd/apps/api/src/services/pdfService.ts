/**
 * PDF Generation Service for AccommodateAI.
 *
 * Generates PDF documents from letter content using PDFKit.
 * Server-side only — no React DOM dependency.
 *
 * PDF Structure:
 *   - Header: Company name + "Accommodation Letter"
 *   - Body: Letter content (plain text, line-by-line)
 *   - Footer: Legal disclaimer + generation date
 */

import PDFDocument from 'pdfkit';
import { LEGAL_DISCLAIMER } from './letterGenerator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfLetterData {
  companyName: string;
  letterType: string;
  content: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// PDF Generation
// ---------------------------------------------------------------------------

/**
 * Generate a PDF buffer from letter data.
 *
 * @param data - Letter content and metadata
 * @returns Buffer containing the PDF binary
 */
export async function generatePdf(data: PdfLetterData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: `${data.letterType} Letter - ${data.companyName}`,
          Author: data.companyName,
          Subject: 'Accommodation Letter',
          Creator: 'AccommodateAI',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // -- Header --
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(data.companyName, { align: 'center' });

      doc
        .fontSize(12)
        .font('Helvetica')
        .text('Accommodation Letter', { align: 'center' });

      doc.moveDown(0.5);

      // Horizontal rule
      doc
        .strokeColor('#cccccc')
        .lineWidth(1)
        .moveTo(72, doc.y)
        .lineTo(540, doc.y)
        .stroke();

      doc.moveDown(1);

      // -- Letter Type Badge --
      const typeLabel = data.letterType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(`Type: ${typeLabel}`, { align: 'right' });

      doc.moveDown(0.5);

      // -- Body --
      doc
        .fontSize(11)
        .font('Helvetica')
        .text(data.content, {
          align: 'left',
          lineGap: 4,
        });

      doc.moveDown(2);

      // -- Footer: Disclaimer --
      doc
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .moveTo(72, doc.y)
        .lineTo(540, doc.y)
        .stroke();

      doc.moveDown(0.5);

      doc
        .fontSize(8)
        .font('Helvetica-Oblique')
        .fillColor('#666666')
        .text(LEGAL_DISCLAIMER, {
          align: 'left',
          lineGap: 2,
        });

      doc.moveDown(0.5);

      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#999999')
        .text(
          `Generated on ${data.createdAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })} by AccommodateAI`,
          { align: 'right' },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
