import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACCOUNTS, FAIL_REASONS, cairoClock, cairoTimeToUtc, normalizeCode } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { openAlert } from '../agents/alerts';
import { assertTeam, type SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { post } from '../finance/ledger';
import { earn } from '../finance/postings';
import { lastHolder, newTicketCode, reverseTicket } from './lost';

const HOUR = 3600 * 1000;
const PHOTO = z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), dataBase64: z.string().min(8) });
const KINDS = ['DAMAGED', 'MISSING_PARCEL', 'FAKE_ATTEMPT', 'LATE_SCAN', 'WRONG_SCAN', 'CUSTOMER_COMPLAINT', 'PALLET_DAMAGED', 'OTHER'] as const;

const TicketInput = z.object({
  kind: z.enum(KINDS),
  shipmentCode: z.string().trim().max(40).optional(),
  courierId: z.string().min(1).max(64).nullish(),
  hubId: z.string().min(1).max(64).nullish(),
  penalty: z.number().int().min(0).max(100_000_000).default(0),
  description: z.string().trim().min(5, 'Say what happened').max(500),
  photo: PHOTO.nullish(),
});
const ReasonInput = z.object({ reason: z.string().trim().min(5, 'Write the reason').max(300) });
const AppealInput = z.object({ text: z.string().trim().min(10, 'Explain why in a sentence or two').max(1000) });
const DecisionInput = z.object({ decision: z.enum(['UPHOLD', 'REVERSE']), note: z.string().trim().min(3).max(300) });
const PenaltyInput = z.object({ penalty: z.number().int().min(0).max(100_000_000) });
const ReviewInput = z.object({ verdict: z.enum(['GENUINE', 'FAKE']), note: z.string().trim().max(300).default(''), penalty: z.number().int().min(0).max(100_000_000).default(0) });
const DamageInput = z.object({ code: z.string().trim().min(3).max(40), note: z.string().trim().min(3, 'Say what is damaged').max(300), photo: PHOTO });
const PalletInput = z.object({ destinationHubId: z.string().min(1).max(64) });
const CodeInput = z.object({ code: z.string().trim().min(3).max(40) });
const SealInput = z.object({ sealNo: z.string().trim().min(2, 'Enter the seal number').max(40), photo: PHOTO });
const ReceivePalletInput = z.object({ condition: z.enum(['GOOD', 'DAMAGED']), note: z.string().trim().max(300).default(''), photo: PHOTO });

function photoBytes(p: z.infer<typeof PHOTO>) {
  const clean = p.dataBase64.includes(',') ? p.dataBase64.slice(p.dataBase64.indexOf(',') + 1) : p.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024) throw new DomainError('invalid_input', 'The photo must be under 3 MB', 422);
  return new Uint8Array(buf);
}

/**
 * Control of the floor: quality tickets with a waiting period and an appeal, the end of the
 * search for lost parcels, pallets with master waybills, trip manifests, damage reports, the
 * cutoff check and the fraud checks.
 */
@Injectable()
export class ControlService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('control tick', e)), 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private audit(db: Tx | PrismaService, user: SessionUser, action: string, entity: string, entityId: string, data: unknown = {}) {
    return db.auditLog.create({ data: { actorUserId: user.id, action, entityType: entity, entityId, after: JSON.parse(JSON.stringify(data)) } });
  }

  // ---------------------------------------------------------------- the timed job

  /** Runs every few minutes: ends searches, applies penalties, checks the cutoff and looks for fraud. */
  async tick(at = new Date()) {
    const lost = await this.finalizeLost(at);
    const confirmed = await this.confirmTickets(at);
    const cutoff = await this.cutoffCheck(at);
    const fraud = await this.fraudChecks(at);
    // Courier locations are kept for 30 days.
    await this.prisma.courierPing.deleteMany({ where: { at: { lt: new Date(at.getTime() - 30 * 24 * HOUR) } } });
    return { lost, confirmed, cutoff, fraud };
  }

  /** A lost parcel not found in time: the merchant is compensated (its COD value, up to the cap). */
  async finalizeLost(at: Date) {
    const s = await this.settings.all();
    const due = await this.prisma.shipment.findMany({ where: { status: 'LOST', lostFinalAt: null, searchUntil: { lte: at } } });
    for (const p of due) {
      await this.prisma.tx(async (tx) => {
        const fresh = await tx.shipment.findUnique({ where: { id: p.id } });
        if (!fresh || fresh.status !== 'LOST' || fresh.lostFinalAt) return;
        const amount = Math.min(fresh.codAmount, s['lost.compensation_cap']);
        await tx.shipment.update({ where: { id: p.id }, data: { lostFinalAt: at, compensation: amount } });
        await post(tx, {
          memo: `${p.trackingNumber} lost: merchant compensated`,
          source: 'LOST_COMPENSATION',
          key: `LOST_COMPENSATION:${p.id}:${at.getTime()}`,
          lines: [
            { account: ACCOUNTS.LOST_PARCELS.code, debit: amount },
            { account: ACCOUNTS.MERCHANT_WALLET.code, party: { type: 'MERCHANT', id: p.merchantId }, credit: amount },
          ],
        });
        await tx.shipmentEvent.create({ data: { shipmentId: p.id, type: 'LOSS_FINAL', fromStatus: 'LOST', toStatus: 'LOST', note: `Not found in time. Merchant compensated ${(amount / 100).toFixed(2)} EGP` } });
      });
    }
    return due.length;
  }

  /** Tickets past their waiting time apply their penalty; the appeal window opens. */
  async confirmTickets(at: Date) {
    const s = await this.settings.all();
    const due = await this.prisma.qcTicket.findMany({ where: { status: 'OPEN', confirmAt: { lte: at } } });
    for (const t of due) {
      await this.prisma.tx(async (tx) => {
        const r = await tx.qcTicket.updateMany({ where: { id: t.id, status: 'OPEN' }, data: { status: 'CONFIRMED', confirmedAt: at, appealUntil: new Date(at.getTime() + s['qc.appeal_hours'] * HOUR) } });
        if (r.count !== 1) return;
        if (t.courierId && t.penalty > 0) {
          await earn(tx, s, { courierId: t.courierId, kind: 'PENALTY', amount: -t.penalty, note: `Quality ticket ${t.code}`, date: todayInCairo(at) });
        }
        if (t.agentId) {
          await openAlert(tx, { kind: 'QC_PENALTY', entity: 'qc_ticket', entityId: t.id, agentId: t.agentId, message: `Ticket ${t.code}: ${t.description}. You can appeal within ${s['qc.appeal_hours']} hours` });
        }
      });
    }
    return due.length;
  }

  /** After the daily cutoff, parcels and bags still in a sorting facility missed today's trucks. */
  async cutoffCheck(at: Date) {
    const s = await this.settings.all();
    const { date, minutes } = cairoClock(at);
    const [h, m] = s['promise.cutoff'].split(':').map(Number) as [number, number];
    if (minutes < h * 60 + m + 60) return 0; // an hour after cutoff the trucks should be gone
    const hubs = await this.prisma.hub.findMany({ where: { isSorting: true, active: true } });
    let n = 0;
    for (const hub of hubs) {
      const [waiting, openBags] = await Promise.all([
        this.prisma.shipment.count({ where: { currentHubId: hub.id, status: { in: ['SORTED', 'AT_OUTBOUND'] } } }),
        this.prisma.bag.count({ where: { originHubId: hub.id, status: { in: ['OPEN', 'SEALED'] }, tripId: null } }),
      ]);
      if (waiting === 0 && openBags === 0) continue;
      await openAlert(this.prisma, { kind: 'CUTOFF_MISSED', entity: 'hub_day', entityId: `${hub.id}:${date}`, hubId: hub.id, severity: 'high', message: `${hub.name}: ${waiting} parcels and ${openBags} bags missed today's trucks` });
      n++;
    }
    return n;
  }

  /** Patterns that need a person to look: too many failures, failures minutes apart, repeated shortages, customers who keep refusing. */
  async fraudChecks(at: Date) {
    const s = await this.settings.all();
    const today = todayInCairo(at);
    const dayStart = new Date(`${today}T00:00:00+03:00`);
    const month = new Date(at.getTime() - 30 * 24 * HOUR);
    let n = 0;
    const fails = await this.prisma.runItem.findMany({ where: { result: 'FAILED', resolvedAt: { gte: dayStart }, NOT: { failReason: 'NOT_ATTEMPTED' } }, select: { resolvedAt: true, run: { select: { courierId: true } } }, orderBy: { resolvedAt: 'asc' } });
    const byCourier = new Map<string, Date[]>();
    for (const f of fails) byCourier.set(f.run.courierId, [...(byCourier.get(f.run.courierId) ?? []), f.resolvedAt!]);
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: [...byCourier.keys()] } }, select: { id: true, name: true, agentId: true } })).map((u) => [u.id, u]));
    for (const [courierId, times] of byCourier) {
      const u = names.get(courierId);
      if (times.length >= s['fraud.max_failed_per_day']) {
        await openAlert(this.prisma, { kind: 'FRAUD_FAILED_SPIKE', entity: 'user_day', entityId: `${courierId}:${today}`, agentId: u?.agentId ?? null, severity: 'high', message: `${u?.name ?? 'A courier'} has ${times.length} failed attempts today. Check them with the customers` });
        n++;
      }
      for (let i = 2; i < times.length; i++) {
        if (times[i]!.getTime() - times[i - 2]!.getTime() <= 5 * 60_000) {
          await openAlert(this.prisma, { kind: 'FRAUD_QUICK_FAILS', entity: 'user_day', entityId: `${courierId}:${today}`, agentId: u?.agentId ?? null, severity: 'high', message: `${u?.name ?? 'A courier'} marked 3 attempts failed within 5 minutes` });
          n++;
          break;
        }
      }
    }
    const refusals = await this.prisma.runItem.findMany({ where: { result: 'FAILED', failReason: 'REFUSED', resolvedAt: { gte: month } }, select: { shipment: { select: { customerPhone: true, customerName: true } } } });
    const byPhone = new Map<string, { n: number; name: string }>();
    for (const r of refusals) {
      const x = byPhone.get(r.shipment.customerPhone) ?? { n: 0, name: r.shipment.customerName };
      x.n++;
      byPhone.set(r.shipment.customerPhone, x);
    }
    for (const [phone, x] of byPhone) {
      if (x.n < 3) continue;
      await openAlert(this.prisma, { kind: 'FRAUD_REPEAT_REFUSER', entity: 'phone', entityId: phone, message: `${x.name} (${phone}) refused ${x.n} parcels in 30 days. Ask merchants to confirm before shipping` });
      n++;
    }
    const shorts = await this.prisma.courierEarning.groupBy({ by: ['courierId'], where: { kind: 'PENALTY', note: { startsWith: 'Cash short' }, createdAt: { gte: month } }, _count: true });
    for (const r of shorts) {
      if (r._count < 3) continue;
      const u = await this.prisma.user.findUnique({ where: { id: r.courierId }, select: { name: true, agentId: true } });
      await openAlert(this.prisma, { kind: 'FRAUD_CASH_SHORT', entity: 'user', entityId: r.courierId, agentId: u?.agentId ?? null, severity: 'high', message: `${u?.name ?? 'A courier'} handed in less cash than collected ${r._count} times in 30 days` });
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- quality tickets

  async createTicket(body: unknown, user: SessionUser) {
    const d = parse(TicketInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const p = d.shipmentCode ? await tx.shipment.findUnique({ where: { trackingNumber: normalizeCode(d.shipmentCode) } }) : null;
      if (d.shipmentCode && !p) throw notFound('Parcel');
      let courierId = d.courierId ?? null;
      let hubId = d.hubId ?? null;
      let responsibleId: string | null = courierId;
      if (p && !courierId && !hubId) {
        const who = await lastHolder(tx, p.id);
        responsibleId = who?.id ?? null;
        if (who?.role === 'courier') courierId = who.id;
        hubId = who?.eventHubId ?? who?.hubId ?? null;
      }
      const courier = courierId ? await tx.user.findFirst({ where: { id: courierId, role: 'courier' } }) : null;
      if (courierId && !courier) throw new DomainError('invalid_input', 'Unknown courier', 422);
      const t = await tx.qcTicket.create({
        data: {
          code: await newTicketCode(tx), kind: d.kind, shipmentId: p?.id ?? null, courierId, agentId: courier?.agentId ?? null, hubId, responsibleId,
          description: d.description, penalty: courierId ? d.penalty : 0, photo: d.photo ? photoBytes(d.photo) : null, photoMime: d.photo?.mime ?? '',
          confirmAt: new Date(Date.now() + s['qc.override_hours'] * HOUR), createdById: user.id,
        },
        omit: { photo: true },
      });
      if (courier?.agentId) await openAlert(tx, { kind: 'QC_TICKET', entity: 'qc_ticket', entityId: t.id, agentId: courier.agentId, message: `Ticket ${t.code} for ${courier.name}: ${d.description}` });
      await this.audit(tx, user, 'QC_TICKET_CREATED', 'qc_ticket', t.id, { kind: d.kind, penalty: t.penalty });
      return t;
    });
  }

  async tickets(query: { status?: string; courierId?: string; agentId?: string }) {
    const rows = await this.prisma.qcTicket.findMany({
      where: { ...(query.status ? { status: query.status as never } : {}), ...(query.courierId ? { courierId: query.courierId } : {}), ...(query.agentId ? { agentId: query.agentId } : {}) },
      omit: { photo: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.courierId, r.responsibleId]).filter((x): x is string => !!x))];
    const [people, parcels, hubs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      this.prisma.shipment.findMany({ where: { id: { in: rows.map((r) => r.shipmentId).filter((x): x is string => !!x) } }, select: { id: true, trackingNumber: true } }),
      this.prisma.hub.findMany({ select: { id: true, code: true } }),
    ]);
    const name = new Map(people.map((p) => [p.id, p.name]));
    const tn = new Map(parcels.map((p) => [p.id, p.trackingNumber]));
    const hc = new Map(hubs.map((h) => [h.id, h.code]));
    return rows.map((r) => ({
      ...r,
      courierName: r.courierId ? name.get(r.courierId) ?? '' : '',
      responsibleName: r.responsibleId ? name.get(r.responsibleId) ?? '' : '',
      trackingNumber: r.shipmentId ? tn.get(r.shipmentId) ?? '' : '',
      hubCode: r.hubId ? hc.get(r.hubId) ?? '' : '',
      hasPhoto: !!r.photoMime,
    }));
  }

  // ---------------------------------------------------------------- checking failed attempts

  /** Every failed attempt and postponement of the last week, for QC to call the customer and check. */
  async attempts(query: { status?: string }) {
    const done = query.status === 'done';
    const rows = await this.prisma.runItem.findMany({
      where: { result: 'FAILED', failReason: { notIn: ['EXCHANGE', 'CUSTOMER_RETURN'] }, resolvedAt: { gte: new Date(Date.now() - 7 * 24 * HOUR) }, reviewVerdict: done ? { not: null } : null },
      omit: { photo: true },
      include: {
        run: { select: { code: true, courierId: true, hubId: true } },
        shipment: { select: { id: true, trackingNumber: true, customerName: true, customerPhone: true, address: true, governorateCode: true, attempts: true, deliverOn: true, merchant: { select: { name: true } } } },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 300,
    });
    const [people, hubs, events] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.run.courierId, r.reviewedById]).filter((x): x is string => !!x))] } }, select: { id: true, name: true, phone: true } }),
      this.prisma.hub.findMany({ select: { id: true, code: true } }),
      this.prisma.shipmentEvent.findMany({
        where: { shipmentId: { in: rows.map((r) => r.shipmentId) }, type: { in: ['ATTEMPT_FAILED', 'RETURN_ATTEMPT_FAILED'] } },
        select: { shipmentId: true, note: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const hub = new Map(hubs.map((h) => [h.id, h.code]));
    return rows.map((r) => {
      const ev = events.find((e) => e.shipmentId === r.shipmentId && r.resolvedAt && Math.abs(e.createdAt.getTime() - r.resolvedAt.getTime()) < 60_000);
      return {
        id: r.id, direction: r.direction, reason: r.failReason, reasonLabel: FAIL_REASONS[r.failReason as keyof typeof FAIL_REASONS]?.label ?? r.failReason,
        note: ev?.note ?? '', at: r.resolvedAt, lat: r.lat, lng: r.lng, flexPaid: r.flexPaid,
        verdict: r.reviewVerdict, reviewNote: r.reviewNote, reviewedBy: r.reviewedById ? person.get(r.reviewedById)?.name ?? '' : '', reviewedAt: r.reviewedAt,
        run: r.run.code, hub: hub.get(r.run.hubId) ?? '', courier: person.get(r.run.courierId) ?? null, courierId: r.run.courierId, parcel: r.shipment,
      };
    });
  }

  /** GENUINE closes the check. FAKE also opens a FAKE_ATTEMPT ticket with the penalty, which waits like any ticket. */
  async reviewAttempt(itemId: string, body: unknown, user: SessionUser) {
    const d = parse(ReviewInput, body);
    const item = await this.prisma.runItem.findUnique({ where: { id: itemId }, omit: { photo: true }, include: { run: true, shipment: { select: { trackingNumber: true } } } });
    if (!item || item.result !== 'FAILED') throw notFound('Attempt');
    if (item.reviewVerdict) throw new DomainError('bad_status', 'This attempt was already checked', 409);
    if (d.verdict === 'FAKE' && d.note.length < 3) throw new DomainError('invalid_input', 'Say what the customer told you', 422);
    const r = await this.prisma.runItem.updateMany({ where: { id: itemId, reviewVerdict: null }, data: { reviewVerdict: d.verdict, reviewNote: d.note, reviewedById: user.id, reviewedAt: new Date() } });
    if (r.count !== 1) throw new DomainError('bad_status', 'This attempt was already checked', 409);
    if (d.verdict === 'GENUINE') return { message: 'Marked as genuine' };
    const label = FAIL_REASONS[item.failReason as keyof typeof FAIL_REASONS]?.label ?? item.failReason;
    const t = await this.createTicket({ kind: 'FAKE_ATTEMPT', shipmentCode: item.shipment.trackingNumber, courierId: item.run.courierId, penalty: d.penalty, description: `Fake attempt on ${item.shipment.trackingNumber} (${label}): ${d.note}` }, user);
    return { message: `Ticket ${t.code} opened`, ticket: t.code };
  }

  async stopPhoto(itemId: string) {
    const r = await this.prisma.runItem.findUnique({ where: { id: itemId }, select: { photo: true, photoMime: true, shipment: { select: { trackingNumber: true } } } });
    if (!r?.photo) throw notFound('Photo');
    return { data: r.photo, mime: r.photoMime, name: r.shipment.trackingNumber };
  }

  // ---------------------------------------------------------------- couriers on the road

  /** The last known place of every courier seen in the last 12 hours, with their run progress. */
  async liveCouriers() {
    const since = new Date(Date.now() - 12 * HOUR);
    const pings = await this.prisma.$queryRaw<{ user_id: string; lat: number; lng: number; accuracy: number | null; at: Date }[]>`
      SELECT DISTINCT ON (user_id) user_id, lat, lng, accuracy, at FROM courier_pings WHERE at >= ${since} ORDER BY user_id, at DESC`;
    const ids = pings.map((p) => p.user_id);
    const [people, runs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, agent: { select: { name: true } }, hub: { select: { code: true } } } }),
      this.prisma.run.findMany({ where: { courierId: { in: ids }, status: { in: ['LOADING', 'OUT'] } }, select: { courierId: true, code: true, status: true, items: { select: { result: true, codCollected: true } } } }),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    return pings
      .map((p) => {
        const u = person.get(p.user_id);
        const run = runs.find((r) => r.courierId === p.user_id);
        return {
          courierId: p.user_id, name: u?.name ?? '', phone: u?.phone ?? '', agent: u?.agent?.name ?? '', hub: u?.hub?.code ?? '',
          lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: p.at,
          run: run ? { code: run.code, status: run.status, total: run.items.length, open: run.items.filter((i) => i.result === 'PENDING').length, cash: run.items.reduce((s, i) => s + i.codCollected, 0) } : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Where a courier went on one day, and where each stop was recorded. */
  async trail(courierId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('invalid_input', 'Pick a date', 422);
    const from = cairoTimeToUtc(date, '00:00');
    const to = new Date(from.getTime() + 24 * HOUR);
    const [pings, stops] = await Promise.all([
      this.prisma.courierPing.findMany({ where: { userId: courierId, at: { gte: from, lt: to } }, select: { lat: true, lng: true, at: true }, orderBy: { at: 'asc' }, take: 3000 }),
      this.prisma.runItem.findMany({
        where: { run: { courierId }, resolvedAt: { gte: from, lt: to } },
        select: { id: true, result: true, failReason: true, lat: true, lng: true, resolvedAt: true, codeChecked: true, photoMime: true, shipment: { select: { trackingNumber: true, address: true } } },
        orderBy: { resolvedAt: 'asc' },
      }),
    ]);
    return { pings, stops: stops.map(({ photoMime, ...s }) => ({ ...s, hasPhoto: !!photoMime })) };
  }

  async ticketPhoto(id: string) {
    const t = await this.prisma.qcTicket.findUnique({ where: { id }, select: { photo: true, photoMime: true, code: true } });
    if (!t?.photo) throw notFound('Photo');
    return { data: t.photo, mime: t.photoMime, name: t.code };
  }

  async setPenalty(id: string, body: unknown, user: SessionUser) {
    const { penalty } = parse(PenaltyInput, body);
    const r = await this.prisma.qcTicket.updateMany({ where: { id, status: 'OPEN', NOT: { courierId: null } }, data: { penalty } });
    if (r.count !== 1) throw new DomainError('bad_status', 'Only an open ticket against a courier can change its penalty', 409);
    await this.audit(this.prisma, user, 'QC_PENALTY_CHANGED', 'qc_ticket', id, { penalty });
  }

  /** Operations cancel a ticket inside its waiting period, with a reason. */
  async override(id: string, body: unknown, user: SessionUser) {
    const { reason } = parse(ReasonInput, body);
    const r = await this.prisma.qcTicket.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'OVERRIDDEN', overrideReason: reason, decidedById: user.id } });
    if (r.count !== 1) throw new DomainError('bad_status', 'The waiting time is over or the ticket is closed', 409);
    await this.audit(this.prisma, user, 'QC_OVERRIDDEN', 'qc_ticket', id, { reason });
  }

  /** The courier (or their agent) appeals a penalty inside the appeal window. */
  async appeal(id: string, body: unknown, user: SessionUser) {
    const { text } = parse(AppealInput, body);
    const t = await this.prisma.qcTicket.findUnique({ where: { id }, omit: { photo: true } });
    if (!t) throw notFound('Ticket');
    const mine = (user.role === 'COURIER' && t.courierId === user.id) || (user.role === 'AGENT' && !!user.agentId && t.agentId === user.agentId);
    if (!mine) throw notFound('Ticket');
    if (t.status !== 'CONFIRMED' || !t.appealUntil || t.appealUntil < new Date()) throw new DomainError('bad_status', 'This ticket can no longer be appealed', 409);
    await this.prisma.qcTicket.update({ where: { id }, data: { status: 'APPEALED', appealText: text } });
    await openAlert(this.prisma, { kind: 'QC_APPEAL', entity: 'qc_ticket', entityId: id, message: `Ticket ${t.code} was appealed: ${text.slice(0, 120)}` });
  }

  async decideAppeal(id: string, body: unknown, user: SessionUser) {
    const d = parse(DecisionInput, body);
    const s = await this.settings.all();
    await this.prisma.tx(async (tx) => {
      const t = await tx.qcTicket.findUnique({ where: { id }, omit: { photo: true } });
      if (!t || t.status !== 'APPEALED') throw new DomainError('bad_status', 'This ticket has no appeal waiting', 409);
      if (d.decision === 'REVERSE') await reverseTicket(tx, s, t, user.id, d.note);
      else await tx.qcTicket.update({ where: { id }, data: { status: 'UPHELD', decisionNote: d.note, decidedById: user.id } });
      await tx.networkAlert.updateMany({ where: { entity: 'qc_ticket', entityId: id, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: user.id, note: d.decision } });
      await this.audit(tx, user, d.decision === 'REVERSE' ? 'QC_REVERSED' : 'QC_UPHELD', 'qc_ticket', id, { note: d.note });
    });
  }

  /** Parcels missing now: still being searched for, or lost for good with the compensation paid. */
  async lostParcels() {
    const rows = await this.prisma.shipment.findMany({
      where: { OR: [{ status: 'LOST' }, { damaged: true, status: { notIn: ['DELIVERED', 'RETURNED', 'CANCELLED'] } }] },
      select: { id: true, trackingNumber: true, status: true, customerName: true, codAmount: true, searchUntil: true, lostFinalAt: true, compensation: true, damaged: true, merchant: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const tickets = await this.prisma.qcTicket.findMany({ where: { shipmentId: { in: rows.map((r) => r.id) } }, select: { shipmentId: true, code: true, status: true, responsibleId: true, kind: true } });
    const who = new Map((await this.prisma.user.findMany({ where: { id: { in: tickets.map((t) => t.responsibleId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((r) => {
      const t = tickets.find((x) => x.shipmentId === r.id);
      return { ...r, ticket: t ? { code: t.code, status: t.status, kind: t.kind, responsible: t.responsibleId ? who.get(t.responsibleId) ?? '' : '' } : null };
    });
  }

  // ---------------------------------------------------------------- damage reports at a hub

  async reportDamage(hubId: string, body: unknown, user: SessionUser) {
    const d = parse(DamageInput, body);
    const photo = photoBytes(d.photo);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const p = await tx.shipment.findUnique({ where: { trackingNumber: normalizeCode(d.code) } });
      if (!p) throw notFound('Parcel');
      if (p.currentHubId !== hubId) throw new DomainError('wrong_hub', 'Scan it into this hub first, then report the damage', 409);
      await tx.shipment.update({ where: { id: p.id }, data: { damaged: true } });
      await tx.shipmentEvent.create({ data: { shipmentId: p.id, type: 'DAMAGED', fromStatus: p.status, toStatus: p.status, hubId, userId: user.id, note: d.note } });
      // Whoever handled it before this hub's scan is held responsible.
      const who = await lastHolder(tx, p.id, user.id);
      const courier = who?.role === 'courier' ? who : null;
      const t = await tx.qcTicket.create({
        data: {
          code: await newTicketCode(tx), kind: 'DAMAGED', shipmentId: p.id, courierId: courier?.id ?? null, agentId: courier?.agentId ?? null, hubId: who?.eventHubId ?? hubId,
          responsibleId: who?.id ?? null, description: `${p.trackingNumber} damaged: ${d.note}`, penalty: 0, photo, photoMime: d.photo.mime,
          confirmAt: new Date(Date.now() + s['qc.override_hours'] * HOUR), createdById: user.id,
        },
        omit: { photo: true },
      });
      await openAlert(tx, { kind: 'PARCEL_DAMAGED', entity: 'shipment', entityId: p.id, hubId, severity: 'high', message: `${p.trackingNumber} arrived damaged at this hub: ${d.note}` });
      return { ticket: t.code, message: `Damage recorded on ${p.trackingNumber}. Ticket ${t.code}` };
    });
  }

  // ---------------------------------------------------------------- pallets and manifests

  private async hub(hubId: string) {
    const h = await this.prisma.hub.findUnique({ where: { id: hubId } });
    if (!h) throw notFound('Hub');
    return h;
  }

  async pallets(hubId: string) {
    const rows = await this.prisma.pallet.findMany({
      where: { OR: [{ originHubId: hubId, status: { in: ['LOADING', 'SEALED'] } }, { destinationHubId: hubId, status: 'IN_TRANSIT' }] },
      omit: { photoOut: true, photoIn: true },
      include: { bags: { select: { id: true, code: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.prisma.shipment.groupBy({ by: ['bagId'], where: { bagId: { in: rows.flatMap((r) => r.bags.map((b) => b.id)) } }, _count: true });
    const hubs = new Map((await this.prisma.hub.findMany({ select: { id: true, code: true, name: true } })).map((h) => [h.id, h]));
    return rows.map((r) => ({
      ...r,
      bags: r.bags.map((b) => ({ ...b, parcels: counts.find((c) => c.bagId === b.id)?._count ?? 0 })),
      outgoing: r.originHubId === hubId,
      destination: hubs.get(r.destinationHubId) ?? null,
      origin: hubs.get(r.originHubId) ?? null,
    }));
  }

  async createPallet(hubId: string, body: unknown, user: SessionUser) {
    const d = parse(PalletInput, body);
    assertTeam(user, await this.hub(hubId), 'OUTBOUND');
    if (d.destinationHubId === hubId) throw new DomainError('invalid_input', 'A pallet goes to another place', 422);
    return this.prisma.tx(async (tx) =>
      tx.pallet.create({ data: { code: await nextCode(tx, 'control_seq', 'PL'), originHubId: hubId, destinationHubId: d.destinationHubId, createdById: user.id }, omit: { photoIn: true, photoOut: true } }),
    );
  }

  async addBag(hubId: string, palletId: string, body: unknown, user: SessionUser) {
    const { code } = parse(CodeInput, body);
    assertTeam(user, await this.hub(hubId), 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const pl = await tx.pallet.findUnique({ where: { id: palletId } });
      if (!pl || pl.originHubId !== hubId) throw notFound('Pallet');
      if (pl.status !== 'LOADING') throw new DomainError('bad_status', 'This pallet is sealed', 409);
      const bag = await tx.bag.findUnique({ where: { code: normalizeCode(code) } });
      if (!bag || bag.originHubId !== hubId) throw notFound(`Bag ${normalizeCode(code)} here`);
      if (bag.status !== 'SEALED') throw new DomainError('bad_status', `Seal bag ${bag.code} first`, 409);
      if (bag.tripId) throw new DomainError('bad_status', `Bag ${bag.code} is already on a trip`, 409);
      if (bag.palletId && bag.palletId !== palletId) throw new DomainError('bad_status', `Bag ${bag.code} is on another pallet`, 409);
      if (bag.destinationHubId !== pl.destinationHubId) throw new DomainError('wrong_hub', `Bag ${bag.code} goes somewhere else`, 409);
      await tx.bag.update({ where: { id: bag.id }, data: { palletId } });
      return { message: `Bag ${bag.code} on pallet ${pl.code}` };
    });
  }

  async removeBag(hubId: string, palletId: string, body: unknown, user: SessionUser) {
    const { code } = parse(CodeInput, body);
    assertTeam(user, await this.hub(hubId), 'OUTBOUND');
    const pl = await this.prisma.pallet.findUnique({ where: { id: palletId } });
    if (!pl || pl.originHubId !== hubId || pl.status !== 'LOADING') throw new DomainError('bad_status', 'That bag cannot come off this pallet now', 409);
    await this.prisma.bag.updateMany({ where: { code: normalizeCode(code), palletId }, data: { palletId: null } });
  }

  /** Strapped and sealed: the seal number and a photo of the pallet as it leaves. */
  async sealPallet(hubId: string, palletId: string, body: unknown, user: SessionUser) {
    const d = parse(SealInput, body);
    assertTeam(user, await this.hub(hubId), 'OUTBOUND');
    const photo = photoBytes(d.photo);
    const pl = await this.prisma.pallet.findUnique({ where: { id: palletId }, include: { bags: { select: { id: true } } } });
    if (!pl || pl.originHubId !== hubId) throw notFound('Pallet');
    if (pl.status !== 'LOADING') throw new DomainError('bad_status', 'This pallet is already sealed', 409);
    if (pl.bags.length === 0) throw new DomainError('invalid_input', 'Put at least one bag on the pallet', 422);
    await this.prisma.pallet.update({ where: { id: palletId }, data: { status: 'SEALED', sealNo: d.sealNo, conditionOut: 'GOOD', photoOut: photo, sealedAt: new Date() } });
    await this.audit(this.prisma, user, 'PALLET_SEALED', 'pallet', palletId, { sealNo: d.sealNo, bags: pl.bags.length });
  }

  /** The pallet goes on the truck: all its bags with it. */
  async loadPallet(hubId: string, tripId: string, body: unknown, user: SessionUser) {
    const { code } = parse(CodeInput, body);
    assertTeam(user, await this.hub(hubId), 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'LOADING') throw new DomainError('bad_status', 'This trip already left', 409);
      const pl = await tx.pallet.findUnique({ where: { code: normalizeCode(code) } });
      if (!pl || pl.originHubId !== hubId) throw notFound(`Pallet ${normalizeCode(code)} here`);
      if (pl.status !== 'SEALED') throw new DomainError('bad_status', `Seal pallet ${pl.code} first`, 409);
      if (pl.tripId && pl.tripId !== tripId) throw new DomainError('bad_status', `Pallet ${pl.code} is on another trip`, 409);
      if (pl.destinationHubId !== trip.destinationHubId) throw new DomainError('wrong_hub', `Pallet ${pl.code} goes somewhere else`, 409);
      await tx.pallet.update({ where: { id: pl.id }, data: { tripId } });
      const r = await tx.bag.updateMany({ where: { palletId: pl.id }, data: { tripId } });
      return { message: `Pallet ${pl.code} loaded with ${r.count} bags` };
    });
  }

  /** At the destination: was the pallet whole? A damaged one opens a ticket and an alert. */
  async receivePallet(hubId: string, palletId: string, body: unknown, user: SessionUser) {
    const d = parse(ReceivePalletInput, body);
    assertTeam(user, await this.hub(hubId), 'INBOUND');
    const photo = photoBytes(d.photo);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const pl = await tx.pallet.findUnique({ where: { id: palletId }, omit: { photoOut: true, photoIn: true } });
      if (!pl || pl.destinationHubId !== hubId) throw notFound('Pallet');
      if (pl.status !== 'IN_TRANSIT') throw new DomainError('bad_status', 'This pallet is not on its way here', 409);
      await tx.pallet.update({ where: { id: palletId }, data: { status: 'ARRIVED', conditionIn: d.condition, photoIn: photo, noteIn: d.note, receivedAt: new Date() } });
      if (d.condition === 'DAMAGED') {
        const t = await tx.qcTicket.create({
          data: {
            code: await newTicketCode(tx), kind: 'PALLET_DAMAGED', hubId: pl.originHubId, description: `Pallet ${pl.code} (seal ${pl.sealNo}) arrived damaged${d.note ? `: ${d.note}` : ''}`,
            photo, photoMime: d.photo.mime, confirmAt: new Date(Date.now() + s['qc.override_hours'] * HOUR), createdById: user.id,
          },
          omit: { photo: true },
        });
        await openAlert(tx, { kind: 'PALLET_DAMAGED', entity: 'pallet', entityId: pl.id, hubId, severity: 'high', message: `Pallet ${pl.code} arrived damaged. Ticket ${t.code}. Check every bag in it` });
      }
      return { message: d.condition === 'DAMAGED' ? 'Damage recorded. Open each bag and scan every parcel' : 'Pallet received. Open each bag and scan every parcel' };
    });
  }

  async palletPhoto(palletId: string, which: 'out' | 'in') {
    const p = await this.prisma.pallet.findUnique({ where: { id: palletId }, select: { photoOut: true, photoIn: true, code: true } });
    const data = which === 'out' ? p?.photoOut : p?.photoIn;
    if (!data) throw notFound('Photo');
    return { data, mime: 'image/jpeg', name: `${p!.code}-${which}` };
  }

  /** What is on a truck: pallets with their seals, bags, every parcel, and the cash on board. */
  async manifest(tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { bags: true } });
    if (!trip) throw notFound('Trip');
    const inBags = await this.prisma.shipment.findMany({ where: { bagId: { in: trip.bags.map((b) => b.id) } }, select: { bagId: true, trackingNumber: true, codAmount: true, merchant: { select: { name: true } } } });
    const [hubs, pallets, back] = await Promise.all([
      this.prisma.hub.findMany({ where: { id: { in: [trip.originHubId, trip.destinationHubId] } }, select: { id: true, code: true, name: true } }),
      this.prisma.pallet.findMany({ where: { tripId }, select: { id: true, code: true, sealNo: true, conditionOut: true } }),
      trip.backhaulOfId ? this.prisma.trip.findUnique({ where: { id: trip.backhaulOfId }, select: { code: true } }) : null,
    ]);
    const hub = (id: string) => hubs.find((h) => h.id === id);
    const parcels = inBags.map(({ bagId, ...p }) => ({ ...p, bag: trip.bags.find((b) => b.id === bagId)?.code ?? '' }));
    return {
      code: trip.code, status: trip.status, vehicle: trip.vehicle, driverName: trip.driverName, departedAt: trip.departedAt, arrivedAt: trip.arrivedAt, createdAt: trip.createdAt,
      backhaulOf: back?.code ?? null, origin: hub(trip.originHubId), destination: hub(trip.destinationHubId),
      pallets: pallets.map((p) => ({ ...p, bags: trip.bags.filter((b) => b.palletId === p.id).map((b) => b.code) })),
      bags: trip.bags.map((b) => ({ code: b.code, parcels: inBags.filter((p) => p.bagId === b.id).length, pallet: pallets.find((p) => p.id === b.palletId)?.code ?? null })),
      parcels, totalParcels: parcels.length, totalCod: parcels.reduce((n, p) => n + p.codAmount, 0),
    };
  }
}
