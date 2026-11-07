import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACCOUNTS, applyBp, formatEgp, splitVat } from '@shiply/shared';
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

const CreditNoteInput = z.object({ invoiceId: z.string().uuid(), amount: MONEY, reason: z.string().trim().min(5, 'Write the reason').max(300) });
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
  supplierId: z.string().uuid(),
  number: z.string().trim().max(60).default(''),
  date: DATE,
  dueDate: DATE,
  accountCode: z.string().trim().min(3).max(10),
  net: MONEY,
  vat: z.number().int().min(0).default(0),
  whtBp: z.number().int().refine((n) => [0, 100, 300, 500].includes(n), 'Withholding is 0%, 1%, 3% or 5%').default(0),
  hubId: z.string().uuid().nullish(),
  note: z.string().trim().max(300).default(''),
  attachment: FILE.nullish(),
});
const BankImportInput = z.object({ fileName: z.string().trim().min(1).max(160), csv: z.string().min(5).max(2_000_000) });
const MatchInput = z.object({ journalLineId: z.string().uuid() });
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
    return db.auditLog.create({ data: { userId: user.id, action, entity, entityId, data: JSON.parse(JSON.stringify(data)) } });
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
  async issueInvoices(body: unknown, user: SessionUser) {
    const { month } = parse(z.object({ month: MONTH }), body);
    if (month >= todayInCairo().slice(0, 7)) throw new DomainError('invalid_input', 'Invoice a month after it ends', 422);
    const merchants = await this.prisma.merchant.findMany({ select: { id: true } });
    const made: string[] = [];
    for (const m of merchants) {
      const done = await this.prisma.taxInvoice.findFirst({ where: { merchantId: m.id, month, kind: 'INVOICE' } });
      if (done) continue;
      const c = await this.chargesFor(this.prisma, m.id, month);
      if (c.lines.length === 0) continue;
      const inv = await this.prisma.tx(async (tx) => {
        const n = await nextNumber(tx, 'invoice_seq');
        return tx.taxInvoice.create({
          data: { number: `INV${month.replace('-', '')}${String(n).padStart(5, '0')}`, kind: 'INVOICE', merchantId: m.id, month, issueDate: todayInCairo(), net: c.net, vat: c.vat, total: c.net + c.vat, lines: { vatBp: c.vatBp, items: c.lines } as never, createdById: user.id },
        });
      });
      made.push(inv.number);
    }
    await this.audit(this.prisma, user, 'INVOICES_ISSUED', 'tax_invoice', month, { count: made.length });
    return { month, made };
  }

  async invoices(query: { month?: string; merchantId?: string }) {
    const rows = await this.prisma.taxInvoice.findMany({
      where: { ...(query.month ? { month: query.month } : {}), ...(query.merchantId ? { merchantId: query.merchantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const merchants = new Map((await this.prisma.merchant.findMany({ select: { id: true, name: true, code: true } })).map((m) => [m.id, m]));
    return rows.map((r) => ({ ...r, merchant: merchants.get(r.merchantId) ?? null }));
  }

  async invoice(id: string, merchantId?: string) {
    const inv = await this.prisma.taxInvoice.findUnique({ where: { id } });
    if (!inv || (merchantId && inv.merchantId !== merchantId)) throw notFound('Invoice');
    const s = await this.settings.all();
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: inv.merchantId } });
    const ref = inv.refInvoiceId ? await this.prisma.taxInvoice.findUnique({ where: { id: inv.refInvoiceId }, select: { number: true } }) : null;
    return {
      ...inv,
      refNumber: ref?.number ?? null,
      issuer: { name: s['company.name'], taxId: s['company.tax_id'], address: s['company.address'] },
      receiver: { name: merchant.name, taxId: merchant.taxId, address: merchant.pickupAddress, code: merchant.code },
    };
  }

  /** A credit note gives money back to the merchant against an invoice; a second person approves it. */
  async createCreditNote(body: unknown, user: SessionUser) {
    const d = parse(CreditNoteInput, body);
    const inv = await this.prisma.taxInvoice.findUnique({ where: { id: d.invoiceId } });
    if (!inv || inv.kind !== 'INVOICE') throw notFound('Invoice');
    const credited = await this.prisma.taxInvoice.aggregate({ where: { refInvoiceId: inv.id, status: { in: ['ISSUED', 'PENDING_APPROVAL'] } }, _sum: { total: true } });
    if (d.amount + (credited._sum.total ?? 0) > inv.total) throw new DomainError('too_much', `Only ${formatEgp(inv.total - (credited._sum.total ?? 0))} of this invoice is left to credit`, 422);
    const s = await this.settings.all();
    const x = splitVat(d.amount, (inv.lines as { vatBp?: number }).vatBp ?? s['tax.vat_bp']);
    return this.prisma.tx(async (tx) => {
      const n = await nextNumber(tx, 'invoice_seq');
      return tx.taxInvoice.create({
        data: {
          number: `CN${inv.month.replace('-', '')}${String(n).padStart(5, '0')}`, kind: 'CREDIT_NOTE', merchantId: inv.merchantId, month: inv.month, issueDate: todayInCairo(),
          net: x.net, vat: x.vat, total: d.amount, lines: { items: [{ description: d.reason, descriptionAr: d.reason, quantity: 1, net: x.net, vat: x.vat, total: d.amount }] } as never,
          refInvoiceId: inv.id, reason: d.reason, status: 'PENDING_APPROVAL', createdById: user.id,
        },
      });
    });
  }

  async decideCreditNote(id: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const cn = await tx.taxInvoice.findUnique({ where: { id } });
      if (!cn || cn.kind !== 'CREDIT_NOTE') throw notFound('Credit note');
      secondPerson(cn.createdById, user);
      const r = await tx.taxInvoice.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'ISSUED' : 'REJECTED', approvedById: user.id } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This credit note is not waiting for approval', 409);
      if (approve) {
        await post(tx, {
          memo: `Credit note ${cn.number}: ${cn.reason}`,
          source: 'CREDIT_NOTE',
          key: `CREDIT_NOTE:${cn.id}`,
          userId: user.id,
          lines: [
            { account: ACCOUNTS.SHIPPING_REVENUE.code, debit: cn.net },
            { account: ACCOUNTS.VAT_OUTPUT.code, debit: cn.vat },
            { account: ACCOUNTS.MERCHANT_WALLET.code, party: { type: 'MERCHANT', id: cn.merchantId }, credit: cn.total },
          ],
        });
      }
      await this.audit(tx, user, approve ? 'CREDIT_NOTE_ISSUED' : 'CREDIT_NOTE_REJECTED', 'tax_invoice', id, { total: cn.total });
    });
  }

  /**
   * The invoice as the Egyptian Tax Authority's document (v1.0). Sending it needs the company's
   * ETA client id and secret and a signing token; until then finance downloads this file.
   */
  async etaDocument(id: string, user: SessionUser) {
    const inv = await this.invoice(id);
    if (inv.status !== 'ISSUED') throw new DomainError('bad_status', 'Only issued documents go to the tax authority', 409);
    const s = await this.settings.all();
    const items = (inv.lines as { vatBp?: number; items: { description: string; quantity: number; net: number; vat: number; total: number }[] }).items;
    const rate = ((inv.lines as { vatBp?: number }).vatBp ?? s['tax.vat_bp']) / 100;
    const egp = (p: number) => Math.round(p) / 100;
    const doc = {
      issuer: { type: 'B', id: inv.issuer.taxId, name: inv.issuer.name, address: { branchID: '0', country: 'EG', governate: 'Cairo', regionCity: 'Cairo', street: inv.issuer.address, buildingNumber: '0' } },
      receiver: { type: inv.receiver.taxId ? 'B' : 'P', id: inv.receiver.taxId, name: inv.receiver.name, address: { country: 'EG', governate: '', regionCity: '', street: inv.receiver.address, buildingNumber: '0' } },
      documentType: inv.kind === 'CREDIT_NOTE' ? 'C' : 'I',
      documentTypeVersion: '1.0',
      dateTimeIssued: `${inv.issueDate}T10:00:00Z`,
      taxpayerActivityCode: s['company.activity_code'],
      internalID: inv.number,
      ...(inv.refNumber ? { references: [inv.refNumber] } : {}),
      invoiceLines: items.map((l) => ({
        description: l.description,
        itemType: 'EGS',
        itemCode: s['company.item_code'],
        unitType: 'EA',
        quantity: Math.max(1, l.quantity),
        internalCode: inv.number,
        salesTotal: egp(l.net),
        total: egp(l.total),
        valueDifference: 0,
        totalTaxableFees: 0,
        netTotal: egp(l.net),
        itemsDiscount: 0,
        unitValue: { currencySold: 'EGP', amountEGP: egp(l.net / Math.max(1, l.quantity)) },
        discount: { rate: 0, amount: 0 },
        taxableItems: [{ taxType: 'T1', amount: egp(l.vat), subType: 'V009', rate }],
      })),
      totalDiscountAmount: 0,
      totalSalesAmount: egp(inv.net),
      netAmount: egp(inv.net),
      taxTotals: [{ taxType: 'T1', amount: egp(inv.vat) }],
      totalAmount: egp(inv.total),
      extraDiscountAmount: 0,
      totalItemsDiscountAmount: 0,
    };
    await this.prisma.taxInvoice.updateMany({ where: { id, etaStatus: 'NOT_SENT' }, data: { etaStatus: 'EXPORTED' } });
    await this.audit(this.prisma, user, 'ETA_EXPORTED', 'tax_invoice', id);
    return { documents: [doc] };
  }

  // ---------------------------------------------------------------- VAT and withholding tax

  /** VAT on sales minus VAT on purchases for a month, and withholding tax held for suppliers. */
  async vatReport(monthQ?: string) {
    const month = monthQ ? parse(MONTH, monthQ) : todayInCairo().slice(0, 7);
    const { from, to } = monthRange(month);
    const sum = async (account: string, extra: object = {}) => {
      const r = await this.prisma.journalLine.aggregate({ where: { accountCode: account, entry: { date: { gte: from, lte: to }, ...extra } }, _sum: { debit: true, credit: true } });
      return { debit: r._sum.debit ?? 0, credit: r._sum.credit ?? 0 };
    };
    const notPayment = { source: { notIn: ['VAT_PAYMENT', 'WHT_PAYMENT'] } };
    const [out, inp, wht] = await Promise.all([sum(ACCOUNTS.VAT_OUTPUT.code, notPayment), sum(ACCOUNTS.VAT_INPUT.code, notPayment), sum(ACCOUNTS.WHT_PAYABLE.code, notPayment)]);
    const [vatPaid, whtPaid] = await Promise.all([
      this.prisma.journalEntry.findFirst({ where: { key: `VAT_PAYMENT:${month}` } }),
      this.prisma.journalEntry.findFirst({ where: { key: `WHT_PAYMENT:${month}` } }),
    ]);
    const outputVat = out.credit - out.debit;
    const inputVat = inp.debit - inp.credit;
    const invoices = await this.prisma.taxInvoice.groupBy({ by: ['kind'], where: { month, status: 'ISSUED' }, _sum: { net: true, vat: true }, _count: true });
    return {
      month, outputVat, inputVat, netVat: outputVat - inputVat, withholding: wht.credit - wht.debit,
      vatPaid: !!vatPaid, whtPaid: !!whtPaid,
      invoices: invoices.map((i) => ({ kind: i.kind, count: i._count, net: i._sum.net ?? 0, vat: i._sum.vat ?? 0 })),
    };
  }

  /** Pays the month's VAT: clears VAT on sales and on purchases, the difference from the bank. */
  async payVat(body: unknown, user: SessionUser) {
    const d = parse(TaxPaymentInput, body);
    if (d.month >= todayInCairo().slice(0, 7)) throw new DomainError('invalid_input', 'Pay a month after it ends', 422);
    const r = await this.vatReport(d.month);
    if (r.vatPaid) throw new DomainError('duplicate', 'VAT for this month is already paid', 409);
    await this.prisma.tx(async (tx) => {
      const net = r.netVat;
      await post(tx, {
        memo: `VAT for ${d.month}${d.reference ? ` (${d.reference})` : ''}`,
        source: 'VAT_PAYMENT',
        key: `VAT_PAYMENT:${d.month}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.VAT_OUTPUT.code, debit: r.outputVat },
          { account: ACCOUNTS.VAT_INPUT.code, credit: r.inputVat },
          net >= 0 ? { account: ACCOUNTS.BANK.code, credit: net } : { account: ACCOUNTS.BANK.code, debit: -net },
        ],
      });
      await this.audit(tx, user, 'VAT_PAID', 'month', d.month, { net });
    });
  }

  async payWithholding(body: unknown, user: SessionUser) {
    const d = parse(TaxPaymentInput, body);
    if (d.month >= todayInCairo().slice(0, 7)) throw new DomainError('invalid_input', 'Pay a month after it ends', 422);
    const r = await this.vatReport(d.month);
    if (r.whtPaid) throw new DomainError('duplicate', 'Withholding tax for this month is already paid', 409);
    if (r.withholding <= 0) throw new DomainError('invalid_input', 'No withholding tax for this month', 422);
    await this.prisma.tx(async (tx) => {
      await post(tx, {
        memo: `Withholding tax for ${d.month}${d.reference ? ` (${d.reference})` : ''}`,
        source: 'WHT_PAYMENT',
        key: `WHT_PAYMENT:${d.month}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.WHT_PAYABLE.code, debit: r.withholding },
          { account: ACCOUNTS.BANK.code, credit: r.withholding },
        ],
      });
      await this.audit(tx, user, 'WHT_PAID', 'month', d.month, { amount: r.withholding });
    });
  }

  // ---------------------------------------------------------------- suppliers and bills

  async suppliers() {
    const [rows, owed] = await Promise.all([this.prisma.supplier.findMany({ orderBy: { name: 'asc' } }), partyBalances(this.prisma, ACCOUNTS.SUPPLIER_PAYABLE.code)]);
    return rows.map((r) => ({ ...r, owed: -(owed.get(r.id) ?? 0) }));
  }

  async saveSupplier(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(SupplierInput, body);
    const s = id ? await this.prisma.supplier.update({ where: { id }, data: d }).catch(() => { throw notFound('Supplier'); }) : await this.prisma.supplier.create({ data: d });
    await this.audit(this.prisma, user, id ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED', 'supplier', s.id, { name: d.name });
    return s;
  }

  async createBill(body: unknown, user: SessionUser) {
    const d = parse(BillInput, body);
    const acc = await this.prisma.account.findUnique({ where: { code: d.accountCode } });
    if (!acc || acc.type !== 'EXPENSE' || !acc.active) throw new DomainError('invalid_input', 'Pick an expense account', 422);
    const sup = await this.prisma.supplier.findUnique({ where: { id: d.supplierId } });
    if (!sup?.active) throw new DomainError('invalid_input', 'Pick an active supplier', 422);
    if (d.dueDate < d.date) throw new DomainError('invalid_input', 'The due date is before the bill date', 422);
    const wht = applyBp(d.net, d.whtBp);
    const total = d.net + d.vat;
    const file = d.attachment ? decodeFile(d.attachment) : null;
    return this.prisma.tx(async (tx) =>
      tx.bill.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'BL'), supplierId: d.supplierId, number: d.number, date: d.date, dueDate: d.dueDate, accountCode: d.accountCode,
          net: d.net, vat: d.vat, whtBp: d.whtBp, wht, total, payable: total - wht, hubId: d.hubId ?? null, note: d.note,
          attachment: file?.data ?? null, mime: file?.mime ?? '', createdById: user.id,
        },
        omit: { attachment: true },
      }),
    );
  }

  async bills(status?: string) {
    const rows = await this.prisma.bill.findMany({ where: status ? { status: status as never } : {}, omit: { attachment: true }, include: { supplier: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const today = todayInCairo();
    return rows.map((r) => ({ ...r, overdue: r.status === 'APPROVED' && r.dueDate < today }));
  }

  async billFile(id: string) {
    const b = await this.prisma.bill.findUnique({ where: { id }, select: { attachment: true, mime: true, code: true } });
    if (!b?.attachment) throw notFound('Attachment');
    return { data: b.attachment, mime: b.mime, name: b.code };
  }

  /** Approving books the bill: the expense, the VAT we can claim back, what we owe, the withholding tax we keep for the state. */
  async decideBill(id: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const b = await tx.bill.findUnique({ where: { id }, omit: { attachment: true }, include: { supplier: true } });
      if (!b) throw notFound('Bill');
      secondPerson(b.createdById, user);
      const r = await tx.bill.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This bill is not waiting for approval', 409);
      if (approve) {
        await post(tx, {
          memo: `Bill ${b.code} from ${b.supplier.name}${b.number ? ` (${b.number})` : ''}`,
          source: 'BILL',
          key: `BILL:${b.id}`,
          date: b.date,
          userId: user.id,
          lines: [
            { account: b.accountCode, debit: b.net },
            { account: ACCOUNTS.VAT_INPUT.code, debit: b.vat },
            { account: ACCOUNTS.SUPPLIER_PAYABLE.code, party: { type: 'SUPPLIER', id: b.supplierId }, credit: b.payable },
            { account: ACCOUNTS.WHT_PAYABLE.code, credit: b.wht },
          ],
        });
      }
      await this.audit(tx, user, approve ? 'BILL_APPROVED' : 'BILL_REJECTED', 'bill', id, { total: b.total });
    });
  }

  async payBill(id: string, body: unknown, user: SessionUser) {
    const { reference } = parse(z.object({ reference: z.string().trim().max(120).default('') }), body ?? {});
    await this.prisma.tx(async (tx) => {
      const b = await tx.bill.findUnique({ where: { id }, omit: { attachment: true }, include: { supplier: true } });
      if (!b || b.status !== 'APPROVED') throw new DomainError('bad_status', 'Approve the bill before paying it', 409);
      await tx.bill.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Paid bill ${b.code} to ${b.supplier.name}`,
        source: 'BILL_PAYMENT',
        key: `BILL_PAYMENT:${b.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.SUPPLIER_PAYABLE.code, party: { type: 'SUPPLIER', id: b.supplierId }, debit: b.payable },
          { account: ACCOUNTS.BANK.code, credit: b.payable, memo: reference },
        ],
      });
      await this.audit(tx, user, 'BILL_PAID', 'bill', id, { payable: b.payable, reference });
    });
  }

  // ---------------------------------------------------------------- bank statement matching

  /** Reads the bank's CSV (date, description, amount or debit and credit, reference) and matches what it can. */
  async importStatement(body: unknown, user: SessionUser) {
    const d = parse(BankImportInput, body);
    const rows = d.csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (rows.length < 2) throw new DomainError('invalid_input', 'The file has no lines', 422);
    const head = csvCells(rows[0]!).map((h) => h.toLowerCase());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const iDate = col('date', 'تاريخ');
    const iDesc = col('description', 'details', 'narrative', 'البيان', 'وصف');
    const iRef = col('reference', 'ref', 'مرجع');
    const iAmount = col('amount', 'المبلغ');
    const iDebit = col('debit', 'withdraw', 'مدين');
    const iCredit = col('credit', 'deposit', 'دائن');
    if (iDate < 0 || (iAmount < 0 && (iDebit < 0 || iCredit < 0))) {
      throw new DomainError('invalid_input', 'The first line must name the columns: date, description, and amount (or debit and credit)', 422);
    }
    const lines: { date: string; description: string; reference: string; amount: number }[] = [];
    const bad: number[] = [];
    rows.slice(1).forEach((row, i) => {
      const c = csvCells(row);
      const date = dateCell(c[iDate] ?? '');
      let amount: number | null;
      if (iAmount >= 0) amount = amountCell(c[iAmount] ?? '');
      else {
        const dr = amountCell(c[iDebit] ?? '') ?? 0;
        const cr = amountCell(c[iCredit] ?? '') ?? 0;
        amount = cr - Math.abs(dr);
      }
      if (!date || amount === null || amount === 0) return void bad.push(i + 2);
      lines.push({ date, description: (c[iDesc] ?? '').slice(0, 300), reference: (iRef >= 0 ? c[iRef] ?? '' : '').slice(0, 120), amount });
    });
    if (lines.length === 0) throw new DomainError('invalid_input', 'No line could be read. Check the dates and amounts', 422);
    const imp = await this.prisma.bankImport.create({ data: { fileName: d.fileName, rows: lines.length, createdById: user.id, lines: { create: lines } } });
    const matched = await this.autoMatch();
    await this.audit(this.prisma, user, 'BANK_IMPORTED', 'bank_import', imp.id, { rows: lines.length, matched });
    return { id: imp.id, rows: lines.length, skippedLines: bad, matched };
  }

  /** Same amount on the bank account in our books, within 5 days; a shared reference wins a tie. */
  async autoMatch() {
    const open = await this.prisma.bankLine.findMany({ where: { matchedLineId: null }, orderBy: { date: 'asc' } });
    if (open.length === 0) return 0;
    const taken = new Set((await this.prisma.bankLine.findMany({ where: { NOT: { matchedLineId: null } }, select: { matchedLineId: true } })).map((b) => b.matchedLineId!));
    const book = await this.prisma.journalLine.findMany({ where: { accountCode: ACCOUNTS.BANK.code }, include: { entry: { select: { date: true, memo: true } } } });
    const days = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000;
    let n = 0;
    for (const b of open) {
      const candidates = book.filter((l) => !taken.has(l.id) && l.debit - l.credit === b.amount && days(l.entry.date, b.date) <= 5);
      if (candidates.length === 0) continue;
      const ref = b.reference || b.description;
      const best = candidates.find((l) => ref && (l.entry.memo.includes(ref) || l.memo.includes(ref))) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!best) continue;
      await this.prisma.bankLine.update({ where: { id: b.id }, data: { matchedLineId: best.id } });
      taken.add(best.id);
      n++;
    }
    return n;
  }

  /** The statement next to the books: what matched, what the bank shows that we did not book, and the other way round. */
  async reconciliation() {
    const [lines, book] = await Promise.all([
      this.prisma.bankLine.findMany({ orderBy: { date: 'desc' }, take: 500 }),
      this.prisma.journalLine.findMany({ where: { accountCode: ACCOUNTS.BANK.code }, include: { entry: { select: { date: true, memo: true, number: true } } }, orderBy: { entry: { number: 'desc' } }, take: 1000 }),
    ]);
    const matchedIds = new Set(lines.filter((l) => l.matchedLineId).map((l) => l.matchedLineId!));
    const bookById = new Map(book.map((b) => [b.id, b]));
    const statementTotal = await this.prisma.bankLine.aggregate({ _sum: { amount: true } });
    const bookBalance = await rawBalance(this.prisma, ACCOUNTS.BANK.code);
    return {
      bookBalance,
      statementTotal: statementTotal._sum.amount ?? 0,
      lines: lines.map((l) => {
        const m = l.matchedLineId ? bookById.get(l.matchedLineId) : null;
        return { ...l, matched: m ? { number: m.entry.number, date: m.entry.date, memo: m.entry.memo } : null };
      }),
      unmatchedBook: book.filter((b) => !matchedIds.has(b.id)).slice(0, 200).map((b) => ({ id: b.id, date: b.entry.date, memo: b.entry.memo, number: b.entry.number, amount: b.debit - b.credit })),
    };
  }

  async matchLine(id: string, body: unknown, user: SessionUser) {
    const { journalLineId } = parse(MatchInput, body);
    const [b, l] = await Promise.all([this.prisma.bankLine.findUnique({ where: { id } }), this.prisma.journalLine.findUnique({ where: { id: journalLineId } })]);
    if (!b) throw notFound('Bank line');
    if (!l || l.accountCode !== ACCOUNTS.BANK.code) throw new DomainError('invalid_input', 'Pick a line on the bank account', 422);
    if (l.debit - l.credit !== b.amount) throw new DomainError('invalid_input', 'The amounts are not the same', 422);
    await this.prisma.bankLine.update({ where: { id }, data: { matchedLineId: journalLineId, matchedById: user.id } }).catch(() => {
      throw new DomainError('duplicate', 'That line is already matched', 409);
    });
  }

  async unmatchLine(id: string) {
    await this.prisma.bankLine.update({ where: { id }, data: { matchedLineId: null, matchedById: null } });
  }

  /** A line the bank shows that we never booked (bank charges, interest): book it and match it. */
  async bookLine(id: string, body: unknown, user: SessionUser) {
    const d = parse(BookInput, body);
    await this.prisma.tx(async (tx) => {
      const b = await tx.bankLine.findUnique({ where: { id } });
      if (!b) throw notFound('Bank line');
      if (b.matchedLineId) throw new DomainError('duplicate', 'This line is already matched', 409);
      const acc = await tx.account.findUnique({ where: { code: d.accountCode } });
      if (!acc || acc.party || !acc.active || acc.code === ACCOUNTS.BANK.code) throw new DomainError('invalid_input', 'Pick an account without wallets', 422);
      const e = await post(tx, {
        memo: `Bank: ${b.description}${d.note ? ` · ${d.note}` : ''}`,
        source: 'BANK_LINE',
        key: `BANK_LINE:${b.id}`,
        date: b.date,
        userId: user.id,
        lines: b.amount > 0
          ? [{ account: ACCOUNTS.BANK.code, debit: b.amount }, { account: d.accountCode, credit: b.amount }]
          : [{ account: ACCOUNTS.BANK.code, credit: -b.amount }, { account: d.accountCode, debit: -b.amount }],
      });
      const line = await tx.journalLine.findFirstOrThrow({ where: { entryId: e!.id, accountCode: ACCOUNTS.BANK.code } });
      await tx.bankLine.update({ where: { id }, data: { matchedLineId: line.id, matchedById: user.id } });
      await this.audit(tx, user, 'BANK_LINE_BOOKED', 'bank_line', id, { account: d.accountCode, amount: b.amount });
    });
  }

  // ---------------------------------------------------------------- cash flow, profit, budgets

  /** Money in and out of the bank and the hub safes in a period, by what moved it. */
  async cashFlow(fromQ?: string, toQ?: string) {
    const today = todayInCairo();
    const from = fromQ ? parse(DATE, fromQ) : `${today.slice(0, 7)}-01`;
    const to = toQ ? parse(DATE, toQ) : today;
    const cash = [ACCOUNTS.BANK.code, ACCOUNTS.HUB_SAFE.code];
    const before = await this.prisma.journalLine.aggregate({ where: { accountCode: { in: cash }, entry: { date: { lt: from } } }, _sum: { debit: true, credit: true } });
    const lines = await this.prisma.journalLine.findMany({ where: { accountCode: { in: cash }, entry: { date: { gte: from, lte: to } } }, select: { debit: true, credit: true, entry: { select: { source: true } } } });
    const by = new Map<string, number>();
    for (const l of lines) by.set(l.entry.source, (by.get(l.entry.source) ?? 0) + l.debit - l.credit);
    const GROUP: Record<string, string> = {
      RUN_CLOSED: 'Operating', PAY_IN: 'Operating', PAYOUT: 'Operating', WITHDRAWAL: 'Operating', AGENT_PAYMENT: 'Operating', AGENT_ADVANCE: 'Operating',
      EXPENSE: 'Operating', BILL_PAYMENT: 'Operating', VAT_PAYMENT: 'Operating', WHT_PAYMENT: 'Operating', BANK_LINE: 'Operating', EARNING_ADJUSTMENT: 'Operating',
      SAFE_DEPOSIT: 'Moved between bank and safes', MANUAL: 'Owner and opening balances',
    };
    const rows = [...by.entries()].filter(([, v]) => v !== 0).map(([source, amount]) => ({ source, group: GROUP[source] ?? 'Operating', amount }));
    const opening = (before._sum.debit ?? 0) - (before._sum.credit ?? 0);
    const change = rows.reduce((n, r) => n + r.amount, 0);
    return { from, to, opening, rows, change, closing: opening + change };
  }

  /** Revenue (before VAT) and courier pay per merchant, per hub and per courier, from the parcels themselves. */
  async profit(fromQ?: string, toQ?: string) {
    const s = await this.settings.all();
    const today = todayInCairo();
    const from = fromQ ? parse(DATE, fromQ) : `${today.slice(0, 7)}-01`;
    const to = toQ ? parse(DATE, toQ) : today;
    const at = { gte: new Date(`${from}T00:00:00+03:00`), lte: new Date(`${to}T23:59:59.999+02:00`) };
    const parcels = await this.prisma.shipment.findMany({
      where: { status: { in: ['DELIVERED', 'RETURNED'] }, closedAt: at },
      select: { id: true, merchantId: true, destinationHubId: true, shippingFee: true, codFee: true, returnFee: true, status: true },
    });
    const earnings = await this.prisma.courierEarning.findMany({ where: { date: { gte: from, lte: to } }, select: { courierId: true, shipmentId: true, amount: true } });
    const costOf = new Map<string, number>();
    for (const e of earnings) if (e.shipmentId) costOf.set(e.shipmentId, (costOf.get(e.shipmentId) ?? 0) + e.amount);
    const net = (p: (typeof parcels)[number]) => splitVat(p.shippingFee + (p.status === 'DELIVERED' ? p.codFee : p.returnFee), s['tax.vat_bp']).net;
    const add = (m: Map<string, { revenue: number; cost: number; parcels: number }>, key: string, revenue: number, cost: number, count = 1) => {
      const r = m.get(key) ?? { revenue: 0, cost: 0, parcels: 0 };
      r.revenue += revenue;
      r.cost += cost;
      r.parcels += count;
      m.set(key, r);
    };
    const byMerchant = new Map<string, { revenue: number; cost: number; parcels: number }>();
    const byHub = new Map<string, { revenue: number; cost: number; parcels: number }>();
    for (const p of parcels) {
      add(byMerchant, p.merchantId, net(p), costOf.get(p.id) ?? 0);
      add(byHub, p.destinationHubId, net(p), costOf.get(p.id) ?? 0);
    }
    // Hub running costs: expenses and bills tagged to the hub.
    const [expenses, bills] = await Promise.all([
      this.prisma.expense.findMany({ where: { status: 'PAID', date: { gte: from, lte: to }, NOT: { hubId: null } }, select: { hubId: true, amount: true } }),
      this.prisma.bill.findMany({ where: { status: { in: ['APPROVED', 'PAID'] }, date: { gte: from, lte: to }, NOT: { hubId: null } }, select: { hubId: true, net: true } }),
    ]);
    for (const e of expenses) add(byHub, e.hubId!, 0, e.amount, 0);
    for (const b of bills) add(byHub, b.hubId!, 0, b.net, 0);
    // Couriers: what their parcels earned us against everything they were paid.
    const delivered = await this.prisma.runItem.findMany({ where: { result: { in: ['DELIVERED', 'RETURNED'] }, resolvedAt: at }, select: { shipmentId: true, run: { select: { courierId: true } } } });
    const parcelById = new Map(parcels.map((p) => [p.id, p]));
    const byCourier = new Map<string, { revenue: number; cost: number; parcels: number }>();
    for (const d of delivered) {
      const p = parcelById.get(d.shipmentId);
      if (p) add(byCourier, d.run.courierId, net(p), 0);
    }
    for (const e of earnings) add(byCourier, e.courierId, 0, e.amount, 0);
    const [merchants, hubs, couriers] = await Promise.all([
      this.prisma.merchant.findMany({ select: { id: true, name: true } }),
      this.prisma.hub.findMany({ select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...byCourier.keys()] } }, select: { id: true, name: true } }),
    ]);
    const table = (m: Map<string, { revenue: number; cost: number; parcels: number }>, names: { id: string; name: string }[]) => {
      const n = new Map(names.map((x) => [x.id, x.name]));
      return [...m.entries()].map(([id, r]) => ({ id, name: n.get(id) ?? '', ...r, profit: r.revenue - r.cost })).sort((a, b) => b.profit - a.profit);
    };
    return { from, to, merchants: table(byMerchant, merchants), hubs: table(byHub, hubs), couriers: table(byCourier, couriers) };
  }

  async budgets(monthQ?: string) {
    const month = monthQ ? parse(MONTH, monthQ) : todayInCairo().slice(0, 7);
    const { from, to } = monthRange(month);
    const [accounts, budgets, actual] = await Promise.all([
      this.prisma.account.findMany({ where: { type: { in: ['INCOME', 'EXPENSE'] }, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.budget.findMany({ where: { month } }),
      this.prisma.journalLine.groupBy({ by: ['accountCode'], where: { entry: { date: { gte: from, lte: to } }, account: { type: { in: ['INCOME', 'EXPENSE'] } } }, _sum: { debit: true, credit: true } }),
    ]);
    return {
      month,
      rows: accounts.map((a) => {
        const r = actual.find((x) => x.accountCode === a.code);
        const amount = a.type === 'EXPENSE' ? (r?._sum.debit ?? 0) - (r?._sum.credit ?? 0) : (r?._sum.credit ?? 0) - (r?._sum.debit ?? 0);
        const budget = budgets.find((b) => b.accountCode === a.code)?.amount ?? 0;
        return { code: a.code, name: a.name, nameAr: a.nameAr, type: a.type, budget, actual: amount, difference: amount - budget };
      }),
    };
  }

  async saveBudgets(body: unknown, user: SessionUser) {
    const d = parse(BudgetInput, body);
    await this.prisma.$transaction(
      d.lines.map((l) => this.prisma.budget.upsert({ where: { accountCode_month: { accountCode: l.accountCode, month: d.month } }, update: { amount: l.amount }, create: { accountCode: l.accountCode, month: d.month, amount: l.amount } })),
    );
    await this.audit(this.prisma, user, 'BUDGETS_SAVED', 'budget', d.month, { lines: d.lines.length });
  }

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
