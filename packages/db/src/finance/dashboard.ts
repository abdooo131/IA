import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import type { Db } from '../client';
import { myActivities } from '../records';
import { getSetting } from '../settings';
import { cashPosition, monthEndChecklist } from './cash-control';
import { missingReceipts } from './controls';

// The Accounting dashboard (Odoo style journal cards): one card per bank account and cash
// box, the store boxes together, merchant payouts, supplier bills, merchant invoices, rider
// withdrawals and approvals, each with its balance, a 30 day sparkline and what waits; above
// them a Today strip of what needs someone now. People limited to some stores see only their
// store boxes, riders and handovers.

export const SPARK_DAYS = 30;

export interface JournalCard {
  key: string;
  /** bank, cash_box, store_boxes, payouts, bills, invoices, riders, approvals */
  kind: string;
  name: { en: string; ar: string } | null;
  code: string | null;
  balancePiastres: number;
  /** One value per day, oldest first, ending today */
  spark: number[];
  waits: { key: string; count: number; amountPiastres?: number; href: string }[];
  actions: { key: string; href: string }[];
  /** Store boxes: one line per store */
  parts?: { id: string; name: { en: string; ar: string }; code: string; balancePiastres: number }[];
}

export interface TodayItem {
  key: string;
  count: number;
  amountPiastres?: number;
  href: string;
}

const dayKeys = (today: string) =>
  Array.from({ length: SPARK_DAYS }, (_, i) => addDays(today, i - (SPARK_DAYS - 1)));

/** Daily sums of something over the last 30 Cairo days, oldest first. */
function daily(today: string, rows: { day: string; value: number }[]) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, (map.get(r.day) ?? 0) + r.value);
  return dayKeys(today).map((d) => map.get(d) ?? 0);
}

/** Balances at the end of each of the last 30 days, from today's balance and daily moves. */
async function balanceSeries(db: Db, accountIds: string[], today: string, now: Date) {
  const series = new Map<string, Map<string, number>>();
  if (accountIds.length === 0) return series;
  const since = cairoDayStart(addDays(today, -(SPARK_DAYS - 1)));
  const rows = await db.$queryRawUnsafe<{ account_id: string; d: string; s: bigint }[]>(
    `SELECT account_id,
            to_char((occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS d,
            SUM(amount_piastres)::bigint AS s
       FROM ledger_lines
      WHERE account_id = ANY($1) AND occurred_at >= $2 AND occurred_at <= $3
      GROUP BY 1, 2`,
    accountIds,
    since,
    now,
  );
  for (const r of rows) {
    const m = series.get(r.account_id) ?? new Map<string, number>();
    m.set(r.d, Number(r.s));
    series.set(r.account_id, m);
  }
  return series;
}

function spark(current: number, moves: Map<string, number> | undefined, today: string) {
  const days = dayKeys(today);
  const out = new Array<number>(days.length);
  let balance = current;
  for (let i = days.length - 1; i >= 0; i--) {
    out[i] = balance;
    balance -= moves?.get(days[i]!) ?? 0;
  }
  return out;
}

const cairoDayOf = (d: Date) => cairoDay(d);

export async function financeDashboard(
  db: Db,
  input: { userId: string; stores: string[] | null; canApprove: boolean; now?: Date },
) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  const limited = input.stores !== null;
  const since = cairoDayStart(addDays(today, -(SPARK_DAYS - 1)));
  const position = await cashPosition(db, { stores: input.stores, now });
  const money = position.money.rows;
  const moves = await balanceSeries(
    db,
    money.map((a) => a.id),
    today,
    now,
  );

  const unmatched = await db.bankStatementLine.groupBy({
    by: ['accountId'],
    where: { status: 'unmatched', accountId: { in: money.map((a) => a.id) } },
    _count: { _all: true },
  });
  const unmatchedOf = (id: string) => unmatched.find((u) => u.accountId === id)?._count._all ?? 0;

  const cards: JournalCard[] = [];
  for (const a of money.filter((x) => x.kind === 'bank' || x.kind === 'cash_box')) {
    const lines = unmatchedOf(a.id);
    cards.push({
      key: `account:${a.id}`,
      kind: a.kind,
      name: { en: a.nameEn, ar: a.nameAr },
      code: a.code,
      balancePiastres: a.balancePiastres,
      spark: spark(a.balancePiastres, moves.get(a.id), today),
      waits:
        a.kind === 'bank'
          ? [{ key: 'bankLines', count: lines, href: `/finance/bank?account=${a.id}` }]
          : [],
      actions:
        a.kind === 'bank'
          ? [
              { key: 'matchLines', href: `/finance/bank?account=${a.id}` },
              { key: 'statement', href: `/finance/accounts/${a.id}` },
            ]
          : [
              { key: 'moveMoney', href: '/finance/movements' },
              { key: 'statement', href: `/finance/accounts/${a.id}` },
            ],
    });
  }

  // Store boxes, one card; the stores' handovers with a difference wait here.
  const boxes = money.filter((x) => x.kind === 'store_box');
  const pendingHandovers = await db.cashHandover.count({
    where: {
      status: 'pending',
      ...(limited && { darkStoreId: { in: input.stores! } }),
    },
  });
  if (boxes.length) {
    const total = boxes.reduce((s, b) => s + b.balancePiastres, 0);
    const series = boxes.map((b) => spark(b.balancePiastres, moves.get(b.id), today));
    const stores = await db.darkStore.findMany({
      where: { id: { in: boxes.map((b) => b.darkStoreId!).filter(Boolean) } },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    cards.push({
      key: 'store_boxes',
      kind: 'store_boxes',
      name: null,
      code: null,
      balancePiastres: total,
      spark: dayKeys(today).map((_, i) => series.reduce((s, x) => s + (x[i] ?? 0), 0)),
      waits: [
        { key: 'handovers', count: pendingHandovers, href: '/finance/cash' },
        {
          key: 'ridersHolding',
          count: position.riders.rows.length,
          amountPiastres: position.riders.totalPiastres,
          href: '/finance/cash-position',
        },
      ],
      actions: [
        { key: 'storeCash', href: '/finance/cash' },
        { key: 'deposit', href: '/finance/cash' },
      ],
      parts: boxes.map((b) => {
        const s = stores.find((x) => x.id === b.darkStoreId);
        return {
          id: b.id,
          code: s?.code ?? b.code,
          name: s ? { en: s.nameEn, ar: s.nameAr } : { en: b.nameEn, ar: b.nameAr },
          balancePiastres: b.balancePiastres,
        };
      }),
    });
  }

  const limit = await getSetting(db, 'finance.approval_threshold_piastres');
  const draftPayouts = limited
    ? []
    : await db.payout.findMany({
        where: { status: 'draft' },
        select: { amountPiastres: true, approvedById: true, createdById: true },
      });
  const payoutsToApprove = draftPayouts.filter(
    (p) =>
      limit > 0 && p.amountPiastres >= limit && !p.approvedById && p.createdById !== input.userId,
  ).length;
  const dueToday = (position.merchants?.rows ?? []).filter(
    (m) => m.nextPayoutDay === today && m.draftPiastres === 0,
  );

  if (!limited) {
    const paid = await db.payout.findMany({
      where: { status: 'paid', paidAt: { gte: since } },
      select: { paidAt: true, amountPiastres: true },
    });
    cards.push({
      key: 'payouts',
      kind: 'payouts',
      name: null,
      code: null,
      balancePiastres: position.merchants?.totalPiastres ?? 0,
      spark: daily(
        today,
        paid.map((p) => ({ day: cairoDayOf(p.paidAt!), value: p.amountPiastres })),
      ),
      waits: [
        {
          key: 'payoutsDueToday',
          count: dueToday.length,
          amountPiastres: dueToday.reduce((s, m) => s + m.owedPiastres, 0),
          href: '/finance/payouts',
        },
        {
          key: 'drafts',
          count: draftPayouts.length,
          href: '/finance/payouts?f=draft',
        },
        ...(input.canApprove
          ? [
              {
                key: 'payoutsToApprove',
                count: payoutsToApprove,
                href: '/finance/payouts?f=for_me_to_approve',
              },
            ]
          : []),
      ],
      actions: [
        { key: 'preparePayouts', href: '/finance/payouts' },
        { key: 'wallets', href: '/finance/merchants' },
      ],
    });

    const bills = await db.bill.findMany({
      where: {
        OR: [
          { status: 'open' },
          { billDate: { gte: new Date(`${addDays(today, -(SPARK_DAYS - 1))}T00:00:00Z`) } },
        ],
      },
      select: {
        status: true,
        billDate: true,
        dueDate: true,
        totalPiastres: true,
        paidPiastres: true,
      },
    });
    const open = bills.filter((b) => b.status === 'open');
    const left = (b: (typeof bills)[number]) => b.totalPiastres - b.paidPiastres;
    const due7 = open.filter((b) => b.dueDate.toISOString().slice(0, 10) <= addDays(today, 7));
    const overdue = open.filter((b) => b.dueDate.toISOString().slice(0, 10) < today);
    cards.push({
      key: 'bills',
      kind: 'bills',
      name: null,
      code: null,
      balancePiastres: open.reduce((s, b) => s + left(b), 0),
      spark: daily(
        today,
        bills.map((b) => ({ day: b.billDate.toISOString().slice(0, 10), value: b.totalPiastres })),
      ),
      waits: [
        {
          key: 'billsDue',
          count: due7.length,
          amountPiastres: due7.reduce((s, b) => s + left(b), 0),
          href: '/finance/bills?f=due_7_days',
        },
        { key: 'billsOverdue', count: overdue.length, href: '/finance/bills?f=overdue' },
      ],
      actions: [
        { key: 'newBill', href: '/finance/bills#new-bill' },
        { key: 'payBills', href: '/finance/bills?f=open' },
      ],
    });

    const invoices = await db.taxInvoice.findMany({
      where: {
        OR: [
          { issuedAt: { gte: since } },
          { etaStatus: { in: ['not_sent', 'invalid', 'rejected'] } },
        ],
      },
      select: { type: true, issuedAt: true, totalPiastres: true, etaStatus: true },
    });
    const thisMonth = invoices.filter(
      (i) => cairoDayOf(i.issuedAt).slice(0, 7) === today.slice(0, 7),
    );
    cards.push({
      key: 'invoices',
      kind: 'invoices',
      name: null,
      code: null,
      balancePiastres: thisMonth.reduce(
        (s, i) => s + (i.type === 'credit_note' ? -i.totalPiastres : i.totalPiastres),
        0,
      ),
      spark: daily(
        today,
        invoices
          .filter((i) => i.issuedAt >= since)
          .map((i) => ({ day: cairoDayOf(i.issuedAt), value: i.totalPiastres })),
      ),
      waits: [
        {
          key: 'invoicesNeedFix',
          count: invoices.filter((i) => i.etaStatus === 'invalid' || i.etaStatus === 'rejected')
            .length,
          href: '/finance/invoices?f=needs_fix',
        },
        {
          key: 'invoicesNotSent',
          count: invoices.filter((i) => i.etaStatus === 'not_sent').length,
          href: '/finance/invoices?f=not_sent',
        },
      ],
      actions: [{ key: 'invoices', href: '/finance/invoices' }],
    });
  }

  const withdrawals = await db.riderWithdrawal.findMany({
    where: {
      ...(limited && { darkStoreId: { in: input.stores! } }),
      OR: [{ status: { in: ['requested', 'approved'] } }, { paidAt: { gte: since } }],
    },
    select: { status: true, amountPiastres: true, paidAt: true },
  });
  const waiting = withdrawals.filter((w) => w.status === 'requested' || w.status === 'approved');
  cards.push({
    key: 'riders',
    kind: 'riders',
    name: null,
    code: null,
    balancePiastres: waiting.reduce((s, w) => s + w.amountPiastres, 0),
    spark: daily(
      today,
      withdrawals
        .filter((w) => w.paidAt)
        .map((w) => ({ day: cairoDayOf(w.paidAt!), value: w.amountPiastres })),
    ),
    waits: [
      {
        key: 'withdrawalsToApprove',
        count: withdrawals.filter((w) => w.status === 'requested').length,
        href: '/finance/rider-withdrawals?f=requested',
      },
      {
        key: 'withdrawalsToPay',
        count: withdrawals.filter((w) => w.status === 'approved').length,
        href: '/finance/rider-withdrawals?f=approved',
      },
    ],
    actions: [
      { key: 'withdrawals', href: '/finance/rider-withdrawals' },
      { key: 'riderWallets', href: '/finance/riders' },
    ],
  });

  const requests = limited
    ? []
    : await db.financeRequest.findMany({
        where: { OR: [{ status: 'pending' }, { createdAt: { gte: since } }] },
        select: { status: true, requestedById: true, amountPiastres: true, createdAt: true },
      });
  const pending = requests.filter((r) => r.status === 'pending');
  const forMe = pending.filter((r) => r.requestedById !== input.userId);
  if (!limited)
    cards.push({
      key: 'approvals',
      kind: 'approvals',
      name: null,
      code: null,
      balancePiastres: pending.reduce((s, r) => s + r.amountPiastres, 0),
      spark: daily(
        today,
        requests
          .filter((r) => r.createdAt >= since)
          .map((r) => ({ day: cairoDayOf(r.createdAt), value: 1 })),
      ),
      waits: [
        ...(input.canApprove
          ? [
              {
                key: 'approvalsForMe',
                count: forMe.length,
                href: '/finance/approvals?f=pending,waiting_for_me',
              },
            ]
          : []),
        {
          key: 'approvalsMine',
          count: pending.length - forMe.length,
          href: '/finance/approvals?f=pending,asked_by_me',
        },
      ],
      actions: [{ key: 'approvals', href: '/finance/approvals' }],
    });

  // ─── today ───
  const activities = await myActivities(db, input.userId, { dueBy: today });
  const bankLines = unmatched.reduce((s, u) => s + u._count._all, 0);
  const lastMonthDay = addDays(`${today.slice(0, 7)}-01`, -1);
  const checklist = limited ? null : await monthEndChecklist(db, lastMonthDay.slice(0, 7), now);
  const billsCard = cards.find((c) => c.kind === 'bills');
  const todayItems: TodayItem[] = [
    ...(input.canApprove && !limited
      ? [
          {
            key: 'approvalsForMe',
            count: forMe.length + payoutsToApprove,
            href: '/finance/approvals?f=pending,waiting_for_me',
          },
        ]
      : []),
    ...(!limited
      ? [
          {
            key: 'payoutsDueToday',
            count: dueToday.length,
            amountPiastres: dueToday.reduce((s, m) => s + m.owedPiastres, 0),
            href: '/finance/payouts',
          },
        ]
      : []),
    {
      key: 'withdrawalsWaiting',
      count: waiting.length,
      amountPiastres: waiting.reduce((s, w) => s + w.amountPiastres, 0),
      href: '/finance/rider-withdrawals',
    },
    { key: 'handoversDifference', count: pendingHandovers, href: '/finance/cash' },
    ...(!limited
      ? [
          { key: 'bankLines', count: bankLines, href: '/finance/bank' },
          {
            key: 'billsDue',
            count: billsCard?.waits[0]?.count ?? 0,
            amountPiastres: billsCard?.waits[0]?.amountPiastres,
            href: '/finance/bills?f=due_7_days',
          },
          {
            key: 'missingReceipts',
            count: (await missingReceipts(db, 0)).count,
            href: '/finance/receipts',
          },
        ]
      : []),
    { key: 'myActivities', count: activities.length, href: '#activities' },
  ];

  return {
    today,
    scope: limited ? ('stores' as const) : ('all' as const),
    todayItems,
    activities: activities.slice(0, 8),
    monthEnd: checklist && {
      month: checklist.month,
      done: checklist.items.filter((i) => i.done).length,
      total: checklist.items.length,
      readyToClose: checklist.readyToClose,
      closed: checklist.items.find((i) => i.id === 'books_closed')?.done ?? false,
    },
    cards,
  };
}
