import type { Response } from 'express';

/** A file name safe for a download header (letters, digits, dots and dashes). */
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'file';

/** Sends a printed contract as a PDF download. */
export function sendContractPdf(res: Response, pdf: Buffer, label: string, lang: 'en' | 'ar') {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader(
    'content-disposition',
    `attachment; filename="${safeName(label.replace(/\s+/g, '-'))}-${lang}.pdf"`,
  );
  res.setHeader('cache-control', 'private, no-store');
  res.send(pdf);
}

/** Sends a signed contract file; photos and PDFs open in the browser. */
export function sendContractFile(
  res: Response,
  file: { fileName: string; contentType: string; data: Uint8Array },
) {
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `inline; filename="${safeName(file.fileName)}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(Buffer.from(file.data));
}
