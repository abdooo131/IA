import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACCOUNTS, applyBp, formatEgp, splitVat } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { resolveAlerts, openAlert } from '../agents/alerts';
import type { SessionUser } from '../auth/auth';
import { nextCode, nextNumber } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { FinanceService } from './finance.service';
import { partyBalances, post, rawBalance } from './ledger';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-07');
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11');
const MONEY = z.number().int().min(1, 'Enter an amount').max(1_000_000_000);
const FILE = z.object({
  fileName: z.string().trim().min(1).max(160).default('file'),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(8),
});

const CreditNoteInput = z.object({ invoiceId: z.string().min(1).max(64), amount: MONEY, reason: z.string().trim().min(5, 'Write the reason').max(300) });
const SupplierInput = z.object({
  name: z.string().trim().min(2).max(120),
  taxId: z.string().trim().max(30).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().email().or(z.literal('')).default(''),
  bankName: z.string().trim().max(80).default(''),
  iban: z.string().trim().toUpperCase().regex(/^(EG\d{27})?$/, 'IBAN must be EG followed by 27 digits').default(''),
  active: z.boolean().default(true),
});
const BillInput = z.object({
  supplierId: z.string().min(1).max(64),
  number: z.string().trim().max(60).default(''),
  date: DATE,
  dueDate: DATE,
  accountCode: z.string().trim().min(3).max(10),
  net: MONEY,
  vat: z.number().int().min(0).default(0),
  whtBp: z.number().int().refine((n) => [0, 100, 300, 500].includes(n), 'Withholding is 0%, 1%, 3% or 5%').default(0),
  hubId: z.string().min(1).max(64).nullish(),
  note: z.string().trim().max(300).default(''),
  attachment: FILE.nullish(),
});
const BankImportInput = z.object({ fileName: z.string().trim().min(1).max(160), csv: z.string().min(5).max(2_000_000) });
const MatchInput = z.object({ journalLineId: z.string().min(1).max(64) });
const BookInput = z.object({ accountCode: z.string().trim().min(3).max(10), note: z.string().trim().max(200).default('') });
const BudgetInput = z.object({ month: MONTH, lines: z.array(z.object({ accountCode: z.string().trim().min(3).max(10), amount: z.number().int().min(0) })).max(200) });
const AdvanceInput = z.object({ amount: MONEY, note: z.string().trim().max(200).default('') });
const TaxPaymentInput = z.object({ month: MONTH, reference: z.string().trim().max(120).default('') });

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Start and end of a Cairo month as instants (Cairo is UTC+2 or +3; a 3 hour margin is enough). */
function monthInstants(month: string) {
  const { from, to } = monthRange(month);
  return { gte: new Date(`${from}T00:00:00+03:00`), lte: new Date(`${to}T23:59:59.999+02:00`) };
}

function secondPerson(createdById: string | null | undefined, user: SessionUser) {
  if (createdById === user.id) throw new DomainError('same_person', 'Someone else must approve what you created', 403);
}

function decodeFile(f: z.infer<typeof FILE>) {
  const clean = f.dataBase64.includes(',') ? f.dataBase64.slice(f.dataBase64.indexOf(',') + 1) : f.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) throw new DomainError('invalid_input', 'The file must be under 5 MB', 422);
  return { data: new Uint8Array(buf), mime: f.mime };
}

/** Splits a CSV line, honouring double quotes. */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** "1,250.50", "(1,250.50)" or "-1250.5" to piastres. */
function amountCell(text: string): number | null {
  const t = text.replace(/[\s,]/g, '').replace(/EGP|ج\.م/gi, '');
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const num = Number(t.replace(/[()\-]/g, ''));
  if (!Number.isFinite(num)) return null;
  return (neg ? -1 : 1) * Math.round(num * 100);
}

/** 2026-11-07, 07/11/2026 or 7-11-2026 to YYYY-MM-DD (day first, as Egyptian banks write it). */
function dateCell(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/**
 * The rest of the books: tax invoices and credit notes (with the ETA file), VAT and withholding
 * tax, suppliers and their bills, the bank statement matched to the books, cash flow, profit
 * per merchant, hub and courier, budgets, cash limits, and agent advances.
 */
@Injectable()
export class BooksService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(() => void this.cashLimitCheck().catch((e) => console.error('cash limits', e)), 10 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private audit(db: Tx | PrismaService, user: SessionUser, action: string, entity: string, entityId: string, data: unknown = {}) {
    return db.auditLog.create({ data: { actorUserId: user.id, action, entityType: entity, entityId, after: JSON.parse(JSON.stringify(data)) } });
  }

  // ---------------------------------------------------------------- tax invoices

  /** What a merchant was charged in a month, parcel by parcel, split into amount before VAT and VAT. */
  private async chargesFor(db: Tx | PrismaService, merchantId: string, month: string) {
    const s = await this.settings.all(db);
    const at = monthInstants(month);
    const [delivered, returned, payouts] = await Promise.all([
      db.shipment.findMany({ where: { merchantId, status: 'DELIVERED', deliveredAt: at }, select: { shippingFee: true, codFee: true } }),
      db.shipment.findMany({ where: { merchantId, status: 'RETURNED', closedAt: at }, select: { shippingFee: true, returnFee: true } }),
      db.payout.findMany({ where: { merchantId, status: 'PAID', paidAt: at }, select: { payoutFee: true } }),
    ]);
    const bp = s['tax.vat_bp'];
    const line = (description: string, descriptionAr: string, quantity: number, amounts: number[]) => {
      let net = 0;
      let vat = 0;
      for (const a of amounts) {
        const x = splitVat(a, bp);
        net += x.net;
        vat += x.vat;
      }
      return { description, descriptionAr, quantity, net, vat, total: net + vat };
    };
    const lines = [
      line('Delivery service', 'خدمة التوصيل', delivered.length + returned.length, [...delivered.map((p) => p.shippingFee), ...returned.map((p) => p.shippingFee)]),
      line('Cash on delivery collection', 'خدمة التحصيل', delivered.filter((p) => p.codFee > 0).length, delivered.map((p) => p.codFee)),
      line('Return to merchant', 'إرجاع للتاجر', returned.length, returned.map((p) => p.returnFee)),
      line('Cash out fee', 'رسوم السحب', payouts.filter((p) => p.payoutFee > 0).length, payouts.map((p) => p.payoutFee)),
    ].filter((l) => l.total > 0);
    return { lines, vatBp: bp, net: lines.reduce((n, l) => n + l.net, 0), vat: lines.reduce((n, l) => n + l.vat, 0) };
  }

  /** Issues one invoice per merchant for a month that has ended. Running it again issues only the missing ones. */
  /** A credit note gives money back to the merchant against an invoice; a second person approves it. */
  /**
   * The invoice as the Egyptian Tax Authority's document (v1.0). Sending it needs the company's
   * ETA client id and secret and a signing token; until then finance downloads this file.
   */
  // ---------------------------------------------------------------- VAT and withholding tax

  /** VAT on sales minus VAT on purchases for a month, and withholding tax held for suppliers. */
  /** Pays the month's VAT: clears VAT on sales and on purchases, the difference from the bank. */
  // ---------------------------------------------------------------- suppliers and bills

  /** Approving books the bill: the expense, the VAT we can claim back, what we owe, the withholding tax we keep for the state. */
  // ---------------------------------------------------------------- bank statement matching

  /** Reads the bank's CSV (date, description, amount or debit and credit, reference) and matches what it can. */
  /** Same amount on the bank account in our books, within 5 days; a shared reference wins a tie. */
  /** The statement next to the books: what matched, what the bank shows that we did not book, and the other way round. */
  /** A line the bank shows that we never booked (bank charges, interest): book it and match it. */
  // ---------------------------------------------------------------- cash flow, profit, budgets

  /** Money in and out of the bank and the hub safes in a period, by what moved it. */
  /** Revenue (before VAT) and courier pay per merchant, per hub and per courier, from the parcels themselves. */
  // ---------------------------------------------------------------- cash limits

  /** Alerts when a courier holds more cash than allowed, or a hub safe holds too much; closes them when back under. */
  async cashLimitCheck() {
    const s = await this.settings.all();
    const [cash, safes] = await Promise.all([partyBalances(this.prisma, ACCOUNTS.COURIER_CASH.code), partyBalances(this.prisma, ACCOUNTS.HUB_SAFE.code)]);
    let raised = 0;
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...cash.keys()] } }, select: { id: true, name: true, agentId: true, hubId: true } })).map((u) => [u.id, u]));
    for (const [id, amount] of cash) {
      if (amount > s['cash.courier_limit']) {
        const u = users.get(id);
        await openAlert(this.prisma, { kind: 'CASH_LIMIT_COURIER', entity: 'user', entityId: id, agentId: u?.agentId ?? null, hubId: u?.hubId ?? null, severity: 'high', message: `${u?.name ?? 'A courier'} holds ${formatEgp(amount)}, over the ${formatEgp(s['cash.courier_limit'])} limit` });
        raised++;
      } else await resolveAlerts(this.prisma, 'user', id, ['CASH_LIMIT_COURIER'], undefined, 'Back under the limit');
    }
    const hubs = new Map((await this.prisma.hub.findMany({ select: { id: true, name: true } })).map((h) => [h.id, h.name]));
    for (const [id, amount] of safes) {
      if (amount > s['cash.safe_limit']) {
        await openAlert(this.prisma, { kind: 'CASH_LIMIT_SAFE', entity: 'hub', entityId: id, hubId: id, severity: 'high', message: `${hubs.get(id) ?? 'A hub'} safe holds ${formatEgp(amount)}, over the ${formatEgp(s['cash.safe_limit'])} limit. Deposit it in the bank` });
        raised++;
      } else await resolveAlerts(this.prisma, 'hub', id, ['CASH_LIMIT_SAFE'], undefined, 'Back under the limit');
    }
    return { raised };
  }

  // ---------------------------------------------------------------- agent advances

  /** How much an agent may take now: a share of this month's settlement so far, less advances already taken. */
  async advanceRoom(agentId: string) {
    const s = await this.settings.all();
    const month = todayInCairo().slice(0, 7);
    const so = await this.finance.computeSettlement(this.prisma, agentId, month);
    const taken = await this.prisma.agentAdvance.aggregate({ where: { agentId, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PAID'] }, settlementId: null }, _sum: { amount: true } });
    const cap = Math.max(0, applyBp(Math.max(0, so.total), s['agents.advance_max_bp']));
    return { month, earnedSoFar: so.total, cap, taken: taken._sum.amount ?? 0, available: Math.max(0, cap - (taken._sum.amount ?? 0)) };
  }

  async requestAdvance(agentId: string, body: unknown, user: SessionUser) {
    const d = parse(AdvanceInput, body);
    const room = await this.advanceRoom(agentId);
    if (d.amount > room.available) throw new DomainError('too_much', `You can take up to ${formatEgp(room.available)} now`, 422);
    return this.prisma.tx(async (tx) => tx.agentAdvance.create({ data: { code: await nextCode(tx, 'money_seq', 'AV'), agentId, amount: d.amount, note: d.note, requestedById: user.id } }));
  }

  async advances(agentId?: string) {
    const rows = await this.prisma.agentAdvance.findMany({ where: agentId ? { agentId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    const agents = new Map((await this.prisma.agent.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    return rows.map((r) => ({ ...r, agentName: agents.get(r.agentId) ?? '' }));
  }

  async decideAdvance(id: string, approve: boolean, user: SessionUser) {
    const a = await this.prisma.agentAdvance.findUnique({ where: { id } });
    if (!a) throw notFound('Advance');
    secondPerson(a.requestedById, user);
    const r = await this.prisma.agentAdvance.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id } });
    if (r.count !== 1) throw new DomainError('bad_status', 'This advance is not waiting for approval', 409);
    await this.audit(this.prisma, user, approve ? 'ADVANCE_APPROVED' : 'ADVANCE_REJECTED', 'agent_advance', id, { amount: a.amount });
  }

  /** Paying an advance: the agent now owes it back, so it comes off their month end payment. */
  async payAdvance(id: string, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const a = await tx.agentAdvance.findUnique({ where: { id } });
      if (!a || a.status !== 'APPROVED') throw new DomainError('bad_status', 'Approve the advance before paying it', 409);
      await tx.agentAdvance.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Advance ${a.code} to agent`,
        source: 'AGENT_ADVANCE',
        key: `AGENT_ADVANCE:${a.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: { type: 'AGENT', id: a.agentId }, debit: a.amount },
          { account: ACCOUNTS.BANK.code, credit: a.amount },
        ],
      });
      await this.audit(tx, user, 'ADVANCE_PAID', 'agent_advance', id, { amount: a.amount });
    });
  }
}
