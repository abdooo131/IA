import {
  addDays,
  billNumber,
  cairoDay,
  cairoDayStart,
  loanNumber,
  monthEnd,
  nextPayoutDay,
  PAYMENT_DUE_GROUPS,
  PAYMENT_DUE_KINDS,
  type PaymentDueGroup,
  type PaymentDueKind,
  payoutNumber,
  shiftDayByMonths,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { packageGross, packageInForce } from '../hr-pay';
import { accountKey, balanceOf } from './ledger';
import { TAXES, type TaxKind } from './payables';
import type { RecurringExpense } from './recurring';

// "Coming up and due" (Accounting dashboard and /finance/due): every payment the company
// already knows it will make, with its due Cairo day, the amount and the screen that pays it.
// Read only: nothing here changes a record.
//
//   recurring   each active recurring expense on its day of every month in the window; a month
//               whose request was approved (posted) or refused is done, one still pending waits
//               in Approvals
//   bill        open supplier bills by due day, what is still unpaid
//   loan        loan instalments not paid yet
//   salaries    the salary run on each month's last day until payroll:<month> is posted, an
//               estimate: the gross of the packages in force that day (tax and insurance
//               shares are not worked out here)
//   tax         VAT, withholding, salary tax, social insurance and martyrs fund owed: what was
//               owed at the start of this month less tax payments since is due at the end of
//               this month, the rest (this month's) at the end of next month. The codebase has
//               no legal calendar, so this is the "end of the next month" rule for every tax
//               (withholding is really quarterly).
//   postal      the postal fees owed to the postal office (fee.postal_bp of our fees per
//               shipment), paid once a month: the same rule as the taxes
//   payout      merchants owed money on their next payout day (schedule); a prepared draft
//               payout is due from the day it was prepared
//
// Items carrying a store (bills and recurring expenses of a store) are shown only to people who
// work in that store; company wide items to everyone with Accounting view; merchant payouts
// only to people with all stores, as on the cash position.

export interface PaymentDueItem {
  /** kind:id, unique in the list */
  key: string;
  kind: PaymentDueKind;
  id: string;
  /** A reference or name (BILL-000012, LN-000001 #3, the recurring expense's name) */
  label: string;
  /** Who is paid (supplier, lender, merchant), when there is one */
  counterparty: string | null;
  /** Null when it cannot be known yet */
  amountPiastres: number | null;
  dueDay: string;
  href: string;
  darkStoreId: string | null;
  /** A word the screens translate: estimate, waiting_approval, prepared, vat, wht... */
  detail: string | null;
}

export interface PaymentsDue {
  today: string;
  until: string;
  items: PaymentDueItem[];
  groups: { key: PaymentDueGroup; count: number; totalPiastres: number; items: PaymentDueItem[] }[];
}

/** The group of a due day: overdue, within 7 days, within 30 days, later. */
export function dueGroupOf(dueDay: string, today: string): PaymentDueGroup {
  if (dueDay < today) return 'overdue';
  if (dueDay <= addDays(today, 7)) return 'week';
  if (dueDay <= addDays(today, 30)) return 'month';
  return 'later';
}

const dayText = (d: Date) => d.toISOString().slice(0, 10);

/** Salary run estimate for a month: the gross of every package in force on its last day. */
async function salaryEstimate(db: Db, lastDay: string) {
  const people = await db.employee.findMany({
    where: {
      employment: 'employee',
      payBasis: 'monthly_salary',
      status: { not: 'left' },
      user: { isActive: true },
    },
    select: { id: true },
  });
  let total = 0;
  for (const p of people) {
    const pkg = await packageInForce(db, p.id, lastDay);
    if (pkg) total += packageGross(pkg);
  }
  return total;
}

const DUE_TAXES: TaxKind[] = ['vat', 'wht', 'payroll_tax', 'social_insurance', 'martyrs_fund'];

export async function paymentsDue(
  db: Db,
  now: Date,
  scope: { stores: string[] | null; days?: number; kinds?: PaymentDueKind[] },
): Promise<PaymentsDue> {
  const today = cairoDay(now);
  const until = addDays(today, Math.max(0, scope.days ?? 30));
  const kinds = new Set(scope.kinds?.length ? scope.kinds : PAYMENT_DUE_KINDS);
  const limited = scope.stores !== null;
  const items: PaymentDueItem[] = [];
  const month = today.slice(0, 7);

  // ─── recurring expenses ───
  if (kinds.has('recurring')) {
    const rows = await db.recurringEntry.findMany({
      where: { isActive: true, startMonth: { lte: until.slice(0, 7) } },
    });
    const months: string[] = [];
    for (let m = month; m <= until.slice(0, 7); m = shiftDayByMonths(`${m}-01`, 1).slice(0, 7))
      months.push(m);
    const keys = rows.flatMap((r) => months.map((m) => `recurring:${r.id}:${m}`));
    const requests = keys.length
      ? await db.financeRequest.findMany({
          where: {
            kind: 'expense',
            OR: keys.map((k) => ({ payload: { path: ['input', 'idempotencyKey'], equals: k } })),
          },
          select: { id: true, status: true, payload: true },
        })
      : [];
    const requestOf = new Map(
      requests.map((q) => [
        (q.payload as { input?: { idempotencyKey?: string } }).input?.idempotencyKey ?? '',
        q,
      ]),
    );
    for (const r of rows) {
      const p = r.payload as unknown as RecurringExpense;
      for (const m of months) {
        if (m < r.startMonth || (r.endMonth && r.endMonth < m)) continue;
        const dueDay = `${m}-${String(r.dayOfMonth).padStart(2, '0')}`;
        if (dueDay > until) continue;
        const request = requestOf.get(`recurring:${r.id}:${m}`);
        // Posted (approved) or refused: nothing more to pay for that month.
        if (request && request.status !== 'pending') continue;
        items.push({
          key: `recurring:${r.id}:${m}`,
          kind: 'recurring',
          id: `${r.id}:${m}`,
          label: r.name,
          counterparty: null,
          amountPiastres: r.amountPiastres,
          dueDay,
          href: request ? `/finance/approvals/${request.id}` : '/finance/recurring',
          darkStoreId: p.darkStoreId ?? null,
          detail: request ? 'waiting_approval' : null,
        });
      }
    }
  }

  // ─── supplier bills ───
  if (kinds.has('bill')) {
    const bills = await db.bill.findMany({
      where: { status: 'open', dueDate: { lte: new Date(`${until}T00:00:00Z`) } },
      select: {
        id: true,
        number: true,
        reference: true,
        dueDate: true,
        totalPiastres: true,
        paidPiastres: true,
        darkStoreId: true,
        supplier: { select: { name: true } },
      },
    });
    for (const b of bills) {
      const left = b.totalPiastres - b.paidPiastres;
      if (left <= 0) continue;
      items.push({
        key: `bill:${b.id}`,
        kind: 'bill',
        id: b.id,
        label: billNumber(b.number),
        counterparty: b.supplier.name,
        amountPiastres: left,
        dueDay: dayText(b.dueDate),
        href: `/finance/bills/${b.id}`,
        darkStoreId: b.darkStoreId,
        detail: null,
      });
    }
  }

  // ─── loan instalments ───
  if (kinds.has('loan')) {
    const rows = await db.loanInstalment.findMany({
      where: { paidAt: null, dueDay: { lte: new Date(`${until}T00:00:00Z`) } },
      select: {
        id: true,
        seq: true,
        dueDay: true,
        instalmentPiastres: true,
        loan: {
          select: {
            id: true,
            number: true,
            lenderName: true,
            supplier: { select: { name: true } },
          },
        },
      },
    });
    for (const i of rows)
      items.push({
        key: `loan:${i.id}`,
        kind: 'loan',
        id: i.id,
        label: `${loanNumber(i.loan.number)} #${i.seq}`,
        counterparty: i.loan.supplier?.name ?? i.loan.lenderName ?? null,
        amountPiastres: i.instalmentPiastres,
        dueDay: dayText(i.dueDay),
        href: `/finance/loans/${i.loan.id}`,
        darkStoreId: null,
        detail: null,
      });
  }

  // ─── salaries ───
  if (kinds.has('salaries')) {
    // Last month too when it was never run (only once a salary run exists at all, so a new
    // system is not told it is late), then every month end in the window.
    const lastMonth = shiftDayByMonths(`${month}-01`, -1).slice(0, 7);
    const everRun = await db.ledgerEntry.findFirst({
      where: { kind: 'payroll' },
      select: { id: true },
    });
    const candidates = [...(everRun ? [lastMonth] : []), month];
    let next = shiftDayByMonths(`${month}-01`, 1).slice(0, 7);
    while (monthEnd(`${next}-01`) <= until) {
      candidates.push(next);
      next = shiftDayByMonths(`${next}-01`, 1).slice(0, 7);
    }
    for (const m of candidates) {
      const lastDay = monthEnd(`${m}-01`);
      if (lastDay > until) continue;
      const run = await db.ledgerEntry.findUnique({
        where: { idempotencyKey: `payroll:${m}` },
        select: { id: true },
      });
      if (run) continue;
      const estimate = await salaryEstimate(db, lastDay);
      if (estimate <= 0) continue;
      items.push({
        key: `salaries:${m}`,
        kind: 'salaries',
        id: m,
        label: m,
        counterparty: null,
        amountPiastres: estimate,
        dueDay: lastDay,
        href: '/finance/payroll',
        darkStoreId: null,
        detail: 'estimate',
      });
    }
  }

  // ─── taxes and postal fees ───
  // What was owed when this month began, less payments since, is due at the end of this
  // month; the rest (this month's) at the end of next month.
  const owedTaxes: { tax: TaxKind; kind: 'tax' | 'postal' }[] = [
    ...(kinds.has('tax') ? DUE_TAXES.map((tax) => ({ tax, kind: 'tax' as const })) : []),
    ...(kinds.has('postal') ? [{ tax: 'postal' as const, kind: 'postal' as const }] : []),
  ];
  if (owedTaxes.length) {
    const monthStart = cairoDayStart(`${month}-01`);
    const thisMonthEnd = monthEnd(today);
    const nextMonthEnd = monthEnd(shiftDayByMonths(`${month}-01`, 1));
    for (const { tax, kind } of owedTaxes) {
      const ref = { type: TAXES[tax] } as const;
      const owedNow = 0 - (await balanceOf(db, ref));
      if (owedNow <= 0) continue;
      const owedBefore = 0 - (await balanceOf(db, ref, monthStart));
      const paid = await db.ledgerLine.aggregate({
        where: {
          account: { key: accountKey(ref) },
          occurredAt: { gte: monthStart },
          entry: { kind: 'tax_payment' },
        },
        _sum: { amountPiastres: true },
      });
      const dueNow = Math.min(owedNow, Math.max(0, owedBefore - (paid._sum.amountPiastres ?? 0)));
      const later = owedNow - dueNow;
      const lastMonth = shiftDayByMonths(`${month}-01`, -1).slice(0, 7);
      if (dueNow > 0 && thisMonthEnd <= until)
        items.push({
          key: `${kind}:${tax}:${lastMonth}`,
          kind,
          id: `${tax}:${lastMonth}`,
          label: lastMonth,
          counterparty: null,
          amountPiastres: dueNow,
          dueDay: thisMonthEnd,
          href: '/finance/taxes',
          darkStoreId: null,
          detail: kind === 'tax' ? tax : null,
        });
      if (later > 0 && nextMonthEnd <= until)
        items.push({
          key: `${kind}:${tax}:${month}`,
          kind,
          id: `${tax}:${month}`,
          label: month,
          counterparty: null,
          amountPiastres: later,
          dueDay: nextMonthEnd,
          href: '/finance/taxes',
          darkStoreId: null,
          detail: kind === 'tax' ? tax : null,
        });
    }
  }

  // ─── merchant payouts ───
  if (kinds.has('payout') && !limited) {
    const wallets = await db.ledgerAccount.findMany({
      where: { type: 'merchant', merchantId: { not: null } },
      select: { id: true, merchantId: true },
    });
    const sums = await db.ledgerLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: wallets.map((w) => w.id) } },
      _sum: { amountPiastres: true },
    });
    const owed = new Map(
      wallets.map((w) => [
        w.merchantId!,
        0 - (sums.find((s) => s.accountId === w.id)?._sum.amountPiastres ?? 0),
      ]),
    );
    const merchants = await db.merchant.findMany({
      where: { id: { in: [...owed.keys()] } },
      select: {
        id: true,
        name: true,
        payoutSchedule: true,
        payouts: {
          where: { status: 'draft' },
          select: { id: true, number: true, amountPiastres: true, createdAt: true },
        },
      },
    });
    for (const m of merchants) {
      if (m.payouts.length) {
        for (const p of m.payouts) {
          const dueDay = cairoDay(p.createdAt);
          if (dueDay > until) continue;
          items.push({
            key: `payout:${p.id}`,
            kind: 'payout',
            id: p.id,
            label: payoutNumber(p.number),
            counterparty: m.name,
            amountPiastres: p.amountPiastres,
            dueDay,
            href: `/finance/payouts/${p.id}`,
            darkStoreId: null,
            detail: 'prepared',
          });
        }
        continue;
      }
      const amount = owed.get(m.id) ?? 0;
      if (amount <= 0) continue;
      const dueDay = nextPayoutDay(m.payoutSchedule, today);
      if (dueDay > until) continue;
      items.push({
        key: `payout:${m.id}:${dueDay}`,
        kind: 'payout',
        id: `${m.id}:${dueDay}`,
        label: m.name,
        counterparty: null,
        amountPiastres: amount,
        dueDay,
        href: '/finance/payouts/run',
        darkStoreId: null,
        detail: null,
      });
    }
  }

  const visible = items
    .filter((i) => !limited || !i.darkStoreId || scope.stores!.includes(i.darkStoreId))
    .sort(
      (a, b) =>
        a.dueDay.localeCompare(b.dueDay) ||
        (b.amountPiastres ?? 0) - (a.amountPiastres ?? 0) ||
        a.key.localeCompare(b.key),
    );
  // "later" exists only on the full page (a window past 30 days).
  const shown = PAYMENT_DUE_GROUPS.filter((g) => g !== 'later' || until > addDays(today, 30));
  const groups = shown.map((key) => {
    const list = visible.filter((i) => dueGroupOf(i.dueDay, today) === key);
    return {
      key,
      count: list.length,
      totalPiastres: list.reduce((s, i) => s + (i.amountPiastres ?? 0), 0),
      items: list,
    };
  });
  return { today, until, items: visible, groups };
}
