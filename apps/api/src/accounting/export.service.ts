import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportData, ReportKind, ReportParams, ReportsService } from './reports.service';

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

/** Report exports are generated in the background (BullMQ when Redis is configured) and stored for download. */
@Injectable()
export class ExportService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.register('report-export', (data: { id: string }) => this.process(data.id));
  }

  async request(ctx: RequestContext, kind: ReportKind, format: 'xlsx' | 'pdf', params: ReportParams) {
    const row = await this.prisma.withContext(ctx, async (tx) => {
      const r = await tx.reportExport.create({
        data: { kind, format, params: params as object, status: 'QUEUED', requestedById: ctx.userId },
      });
      await this.audit.record(tx, ctx, { action: 'finance.report_export', entityType: 'report_export', entityId: r.id, after: { kind, format, params } });
      return r;
    });
    await this.jobs.enqueue('report-export', { id: row.id });
    return strip(row);
  }

  list(ctx: RequestContext) {
    return this.prisma.withContext(ctx, async (tx) =>
      tx.reportExport.findMany({ orderBy: { createdAt: 'desc' }, take: 30, omit: { content: true } }),
    );
  }

  async download(ctx: RequestContext, id: string) {
    const r = await this.prisma.withContext(ctx, (tx) => tx.reportExport.findUnique({ where: { id } }));
    if (!r || r.status !== 'DONE' || !r.content) throw new NotFoundException('Export is not ready');
    return { fileName: r.fileName!, format: r.format, content: Buffer.from(r.content) };
  }

  async process(id: string) {
    await this.prisma.asSystem((tx) => tx.reportExport.update({ where: { id }, data: { status: 'RUNNING' } }));
    try {
      const job = await this.prisma.asSystem((tx) => tx.reportExport.findUniqueOrThrow({ where: { id } }));
      const data = await this.prisma.asSystem((tx) => this.reports.build(tx, job.kind as ReportKind, job.params as ReportParams), { timeout: 60000 });
      const content = job.format === 'xlsx' ? await toExcel(data) : await toPdf(data);
      const fileName = `shiply-${job.kind.replace(/_/g, '-')}-${data.period.replace(/[^0-9a-z]+/gi, '-').toLowerCase()}.${job.format}`;
      await this.prisma.asSystem((tx) =>
        tx.reportExport.update({ where: { id }, data: { status: 'DONE', content: new Uint8Array(content), fileName, finishedAt: new Date() } }),
      );
    } catch (e) {
      await this.prisma.asSystem((tx) =>
        tx.reportExport.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500), finishedAt: new Date() } }),
      );
      throw e;
    }
  }
}

function strip<T extends { content?: unknown }>(r: T) {
  const { content: _c, ...rest } = r;
  return rest;
}

const egp = (p: number) => p / 100;

export async function toExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Shiply';
  const ws = wb.addWorksheet(data.title.slice(0, 31));
  ws.addRow([data.title]).font = { bold: true, size: 14 };
  ws.addRow([data.period, '', 'Amounts in EGP']);
  ws.addRow([]);
  const header = ws.addRow(data.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF2' } }));
  for (const r of data.rows) {
    const row = ws.addRow(
      data.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return null;
        return c.type === 'money' ? egp(Number(v)) : v;
      }),
    );
    if (r.style) row.font = { bold: true };
    if (r.style === 'section') row.font = { bold: true, color: { argb: 'FF5C667A' } };
  }
  data.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === 'text' ? Math.max(14, c.label.length + 4) : 18;
    if (c.type === 'money') col.numFmt = '#,##0.00';
  });
  ws.getColumn(data.columns.findIndex((c) => c.type === 'text') + 1).width = 42;
  if (data.checks.length) {
    ws.addRow([]);
    for (const ch of data.checks) ws.addRow([`${ch.ok ? 'OK' : 'FAILED'}: ${ch.label}`]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(data: ReportData): Promise<Buffer> {
  const landscape = data.columns.length > 5;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
  doc.registerFont('r', join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('b', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const width = doc.page.width - 72;
  doc.font('b').fontSize(16).text('Shiply · ' + data.title);
  doc.font('r').fontSize(9).fillColor('#5c667a').text(`${data.period} · amounts in EGP · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.moveDown(0.8).fillColor('#000');

  const textCols = data.columns.filter((c) => c.type === 'text').length;
  const numW = 78;
  const textW = (width - numW * (data.columns.length - textCols)) / Math.max(1, textCols);
  const widths = data.columns.map((c) => (c.type === 'text' ? textW : numW));
  const fmt = (c: { type: string }, v: unknown) => {
    if (v === null || v === undefined || v === '') return '';
    if (c.type === 'money') return (Number(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(v);
  };
  const drawRow = (cells: string[], bold: boolean, shade?: string) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    if (shade) doc.rect(36, y - 2, width, 15).fill(shade).fillColor('#000');
    let x = 36;
    doc.font(bold ? 'b' : 'r').fontSize(8);
    cells.forEach((cell, i) => {
      const num = data.columns[i].type !== 'text';
      doc.text(cell, x + 2, y, { width: widths[i] - 4, align: num ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 15;
  };
  drawRow(data.columns.map((c) => c.label), true, '#e8ecf2');
  for (const r of data.rows) {
    drawRow(
      data.columns.map((c) => fmt(c, r[c.key])),
      !!r.style,
      r.style === 'total' ? '#f4f6f9' : undefined,
    );
  }
  if (data.checks.length) {
    doc.moveDown(0.5);
    for (const ch of data.checks) doc.font('r').fontSize(8).fillColor(ch.ok ? '#047857' : '#b91c1c').text(`${ch.ok ? 'OK' : 'FAILED'}: ${ch.label}`, 36);
  }
  doc.end();
  return done;
}
