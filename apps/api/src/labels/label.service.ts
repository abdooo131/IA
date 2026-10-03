import { Injectable } from '@nestjs/common';
import { formatPiastres, PACKAGE_SIZE_DIMENSIONS, PackageSize } from '@shiply/shared';
import * as bwipjs from 'bwip-js';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { breakLines, drawBidiLine, hasArabic } from './bidi';

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const FONT = join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = join(FONT_DIR, 'DejaVuSans-Bold.ttf');

export interface LabelOrder {
  trackingNumber: string;
  merchantReference: string | null;
  type: string;
  size: string;
  codAmount: number;
  allowOpenPackage: boolean;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  area: string;
  itemsDescription: string | null;
  notes: string | null;
  createdAt: Date;
  merchant: { nameEn: string; nameAr: string };
  governorate: { nameEn: string; nameAr: string };
  destinationHub: { code: string } | null;
  pickupLocation: { name: string; area: string } | null;
}

export async function barcodePng(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 14, includetext: false, paddingwidth: 0 });
}

/** AWB label, 4x6 inch (288 x 432 pt), one order per page. */
@Injectable()
export class LabelService {
  async render(orders: LabelOrder[], trackingBaseUrl: string): Promise<Buffer> {
    const doc = new PDFDocument({ size: [288, 432], margin: 12, autoFirstPage: false, info: { Title: 'Shiply AWB' } });
    doc.registerFont('regular', FONT);
    doc.registerFont('bold', FONT_BOLD);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    for (const o of orders) {
      doc.addPage();
      await this.page(doc, o, trackingBaseUrl);
    }
    doc.end();
    return done;
  }

  private async page(doc: PDFKit.PDFDocument, o: LabelOrder, trackingBaseUrl: string) {
    const W = 288;
    const M = 12;
    const inner = W - 2 * M;
    const line = (y: number) => doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).stroke('#000');
    const text = (s: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number } = {}) => {
      doc.font(opts.font ?? 'regular').fontSize(opts.size ?? 8);
      const align = opts.align ?? (hasArabic(s) ? 'right' : 'left');
      const width = opts.width ?? inner;
      if (hasArabic(s)) {
        // Break in logical order, then draw each line run by run so mixed Arabic / Latin reads correctly.
        const lh = doc.currentLineHeight(true);
        const maxLines = opts.lineBreak === false ? 1 : Math.max(1, Math.floor((opts.height ?? 1000) / lh));
        breakLines(s, width, (w) => doc.widthOfString(w))
          .slice(0, maxLines)
          .forEach((ln, i) => drawBidiLine(doc, ln, x, y + i * lh, width, align as 'left' | 'right' | 'center'));
        return;
      }
      doc.text(s, x, y, { width, align, lineBreak: opts.lineBreak ?? true, height: opts.height, ellipsis: true });
    };

    // Header
    text('SHIPLY', M, M, { font: 'bold', size: 16 });
    text(`${o.merchant.nameEn}`, M, M + 2, { font: 'bold', size: 9, align: 'right' });
    text(o.merchant.nameAr, M, M + 13, { size: 8, align: 'right' });
    line(42);

    // Barcode
    const png = await barcodePng(o.trackingNumber);
    doc.image(png, M + 10, 48, { width: inner - 20, height: 52 });
    text(o.trackingNumber, M, 104, { font: 'bold', size: 13, align: 'center' });
    line(122);

    // Destination block
    const hub = o.destinationHub?.code ?? 'MANUAL';
    doc.rect(W - M - 70, 127, 70, 34).fill('#000');
    doc.fillColor('#fff');
    text(hub, W - M - 70, 137, { font: 'bold', size: 13, width: 70, align: 'center' });
    doc.fillColor('#000');
    text(o.area, M, 128, { font: 'bold', size: 11, width: inner - 76, align: 'left', lineBreak: false });
    text(o.governorate.nameEn, M, 146, { size: 9, width: inner - 80, align: 'left', lineBreak: false });
    text(o.governorate.nameAr, M, 146, { size: 9, width: inner - 80, align: 'right', lineBreak: false });
    line(166);

    // Customer
    text('TO', M, 171, { size: 7 });
    text(o.customerName, M, 180, { font: 'bold', size: 11 });
    text(o.customerPhone, M, 195, { size: 10 });
    text(o.addressLine, M, 209, { size: 9, height: 36 });
    line(250);

    // COD and package facts
    text('COD', M, 255, { size: 7 });
    text(formatPiastres(o.codAmount), M, 265, { font: 'bold', size: o.codAmount >= 100000 ? 14 : 17, width: inner / 2 + 10, lineBreak: false });
    const facts = [
      `Type: ${o.type}`,
      `Size: ${o.size} (${PACKAGE_SIZE_DIMENSIONS[o.size as PackageSize] ?? ''})`,
      `Open package: ${o.allowOpenPackage ? 'ALLOWED' : 'NOT ALLOWED'}`,
    ];
    facts.forEach((f, i) => text(f, M + inner / 2, 256 + i * 11, { size: 7.5, width: inner / 2 }));
    line(292);

    // Details
    text(`Ref: ${o.merchantReference ?? '-'}`, M, 297, { size: 8 });
    text(`Created: ${o.createdAt.toISOString().slice(0, 10)}`, M, 297, { size: 8, align: 'right' });
    text('Items', M, 310, { size: 7 });
    text(o.itemsDescription ?? '-', M, 319, { size: 8, height: 20 });
    text('Notes', M, 342, { size: 7 });
    text(o.notes ?? '-', M, 351, { size: 8, height: 20 });
    line(378);
    text(`From: ${o.pickupLocation ? `${o.pickupLocation.name}, ${o.pickupLocation.area}` : '-'}`, M, 383, { size: 7.5 });
    text('Track: ' + trackingBaseUrl + o.trackingNumber, M, 396, { size: 7.5 });
    text('Signature: ____________________', M, 410, { size: 7.5 });
  }
}
