import { Injectable, NotFoundException } from '@nestjs/common';
import { formatPiastres } from '@shiply/shared';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { drawBidiLine, hasArabic } from '../labels/bidi';
import { PrismaService } from '../prisma/prisma.service';
import { routeStops } from '../routing/route';
import { FAILED_REASON_TEXT } from './dispatch.service';

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

interface SheetRow {
  seq: number;
  eta: string;
  tracking: string;
  name: string;
  phone: string;
  address: string;
  cod: number;
  note: string;
}

/** Printable daily run sheet per driver, stops in route order (in house routing). */
@Injectable()
export class RunSheetService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async build(ctx: RequestContext, driverId: string): Promise<{ fileName: string; pdf: Buffer }> {
    const data = await this.prisma.withContext(ctx, async (tx) => {
      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { hub: true } });
      if (!driver) throw new NotFoundException('Driver not found');
      const cfg = await this.config.getMany(['routing.road_factor_bp', 'routing.average_speed_kmh', 'routing.stop_buffer_minutes'], tx);
      const routeCfg = {
        roadFactorBp: cfg['routing.road_factor_bp'] as number,
        speedKmh: cfg['routing.average_speed_kmh'] as number,
        stopBufferMin: cfg['routing.stop_buffer_minutes'] as number,
      };
      const start = driver.hub ? { lat: driver.hub.lat, lng: driver.hub.lng } : { lat: 30.0444, lng: 31.2357 };
      let rows: SheetRow[] = [];
      if (driver.type === 'DELIVERY') {
        const orders = await tx.order.findMany({
          where: { deliveryDriverId: driver.id, status: { in: ['ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER'] } },
          include: { merchant: { select: { nameEn: true } } },
        });
        const routed = routeStops(start, orders.map((o) => ({ lat: o.lat, lng: o.lng, item: o })) as never, routeCfg);
        rows = routed.map((r) => {
          const o = r.item as (typeof orders)[number];
          const notes = [o.allowOpenPackage ? 'Open package OK' : '', o.attempts ? `Attempt ${o.attempts + 1}` : '', o.lastFailedReason ? FAILED_REASON_TEXT[o.lastFailedReason as keyof typeof FAILED_REASON_TEXT] : '', o.notes ?? '']
            .filter(Boolean)
            .join(' · ');
          return { seq: r.seq, eta: eta(r.etaMinutes), tracking: o.trackingNumber, name: `${o.customerName} (${o.merchant.nameEn})`, phone: o.customerPhone, address: `${o.addressLine}, ${o.area}`, cod: o.codAmount, note: notes };
        });
      } else {
        const orders = await tx.order.findMany({
          where: { pickupDriverId: driver.id, status: 'PENDING_PICKUP' },
          include: { merchant: { select: { nameEn: true } }, pickupLocation: true },
        });
        const stops = new Map<string, { lat: number | null; lng: number | null; item: { name: string; phone: string; address: string; count: number; trackings: string[] } }>();
        for (const o of orders) {
          const key = o.pickupLocationId ?? o.merchantId;
          if (!stops.has(key)) {
            stops.set(key, {
              lat: o.pickupLocation?.lat ?? null,
              lng: o.pickupLocation?.lng ?? null,
              item: { name: `${o.merchant.nameEn} · ${o.pickupLocation?.name ?? ''}`, phone: o.pickupLocation?.contactPhone ?? '', address: o.pickupLocation ? `${o.pickupLocation.addressLine}, ${o.pickupLocation.area}` : '', count: 0, trackings: [] },
            });
          }
          const st = stops.get(key)!;
          st.item.count++;
          st.item.trackings.push(o.trackingNumber);
        }
        const routed = routeStops(start, [...stops.values()] as never, routeCfg);
        rows = routed.map((r) => {
          const s = r.item as { name: string; phone: string; address: string; count: number; trackings: string[] };
          return { seq: r.seq, eta: eta(r.etaMinutes), tracking: `${s.count} parcels`, name: s.name, phone: s.phone, address: s.address, cod: 0, note: s.trackings.slice(0, 6).join(' ') + (s.trackings.length > 6 ? ' …' : '') };
        });
      }
      return { driver, rows };
    });
    const pdf = await renderSheet(data.driver.type, data.driver.fullName, data.driver.phone, data.driver.hub?.nameEn ?? '', data.rows);
    return { fileName: `runsheet-${data.driver.fullName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`, pdf };
  }
}

function eta(min: number) {
  const start = 9 * 60 + min; // the day starts at 09:00
  return `${String(Math.floor(start / 60) % 24).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
}

async function renderSheet(type: string, name: string, phone: string, hub: string, rows: SheetRow[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  doc.registerFont('r', join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('b', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 60;
  const text = (s: string, x: number, y: number, w: number, align: 'left' | 'right' = 'left') => {
    if (hasArabic(s)) drawBidiLine(doc, s, x, y, w, align === 'left' && hasArabic(s) ? 'right' : align);
    else doc.text(s, x, y, { width: w, align, lineBreak: false, ellipsis: true });
  };

  doc.font('b').fontSize(16).text(`Shiply · ${type === 'DELIVERY' ? 'Delivery' : 'Pickup'} run sheet`, 30, 30);
  doc.font('r').fontSize(10).text(`${name} · ${phone} · ${hub} · ${new Date().toISOString().slice(0, 10)}`, 30, 52);
  const totalCod = rows.reduce((s, r) => s + r.cod, 0);
  doc.font('b').fontSize(10).text(`${rows.length} stops${type === 'DELIVERY' ? ` · COD to collect ${formatPiastres(totalCod)}` : ''}`, 30, 52, { width: W, align: 'right' });

  const cols = [
    { key: 'seq', label: '#', w: 22 },
    { key: 'eta', label: 'ETA', w: 38 },
    { key: 'tracking', label: type === 'DELIVERY' ? 'Tracking' : 'Parcels', w: 92 },
    { key: 'name', label: type === 'DELIVERY' ? 'Customer' : 'Merchant', w: 150 },
    { key: 'phone', label: 'Phone', w: 88 },
    { key: 'address', label: 'Address', w: 190 },
    { key: 'cod', label: 'COD', w: 70 },
    { key: 'note', label: 'Notes', w: 0 },
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1].w = W - fixed - 70;
  let y = 76;
  const header = () => {
    doc.rect(30, y - 3, W, 16).fill('#e8ecf2').fillColor('#000');
    let x = 30;
    doc.font('b').fontSize(8);
    for (const c of cols) {
      text(c.label, x + 2, y, c.w - 4, c.key === 'cod' ? 'right' : 'left');
      x += c.w;
    }
    text('Signature / result', x + 2, y, 66);
    y += 18;
  };
  header();
  for (const r of rows) {
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = 30;
      header();
    }
    let x = 30;
    doc.font('r').fontSize(8);
    const values: Record<string, string> = { ...r, seq: String(r.seq), cod: type === 'DELIVERY' ? formatPiastres(r.cod) : '' } as never;
    for (const c of cols) {
      if (c.key === 'tracking') doc.font('b');
      text(values[c.key] ?? '', x + 2, y, c.w - 4, c.key === 'cod' ? 'right' : 'left');
      doc.font('r');
      x += c.w;
    }
    doc.rect(x + 2, y - 3, 64, 18).lineWidth(0.5).stroke('#9aa3b2');
    doc.moveTo(30, y + 17).lineTo(30 + W, y + 17).lineWidth(0.3).stroke('#dfe4ec');
    y += 24;
  }
  y += 10;
  doc.font('r').fontSize(9).fillColor('#000').text(`Driver signature: ______________________     Hub staff: ______________________     Cash received: ______________`, 30, y);
  doc.end();
  return done;
}
