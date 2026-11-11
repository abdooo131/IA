import type { Prisma } from '@prisma/client';
import {
  cairoDay,
  cairoDayStart,
  daysInMonth,
  EMPTY_OPENING,
  FORECAST_LINE_ACCOUNT_KEYS,
  FORECAST_MONTHS,
  type ForecastDriverRow,
  type ForecastOpening,
  type ForecastResult,
  forecastAddMonths,
  forecastBudgetRows,
  forecastCompute,
  forecastLineAccount,
  forecastMonths,
  forecastNumber,
  isForecastDriverKey,
  isForecastLineKey,
  mulDiv,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { packageGross, packageInForce } from '../hr-pay';
import { getSetting } from '../settings';
import { monthlyPart } from './assets';
import { accountIdOf, type SystemAccountKey } from './ledger';
import { setBudget, VAT_PURCHASE_KINDS } from './period';

type Tx = Prisma.TransactionClient;

// Forecast (Accounting > Planning > Forecast): named scenarios of the next 12 Cairo months.
// The suggestion reads the last complete months of the books; drivers and line overrides
// are edited by people; forecastCompute (packages/shared/src/forecast.ts) turns them into
// profit and loss, balance sheet and cash flow; an approved scenario can be written into
// the budgets through setBudget. Nothing here posts to the ledger.

const monthStart = (m: string) => cairoDayStart(`${m}-01`);
const cairoMonth = (d: Date) => cairoDay(d).slice(0, 7);

/** Line accounts that are not "fixed per account" in the suggestion. */
const DRIVER_ACCOUNT_KEYS = new Set<string>([
  ...Object.values(FORECAST_LINE_ACCOUNT_KEYS),
  // Booked once a year at the year's last moment: averaging it would mislead.
  'income_tax_expense',
]);
/** Driver lines whose account is opened the first time it is named (system accounts). */
const SYSTEM_LINE_KEYS = new Set<string>([
  'revenue',
  'rider_bonus_expense',
  'rider_office_commission',
  'depreciation_expense',
  'loan_interest_expense',
]);

// ─── opening balances ─────────────────────────────────────────────────────────

/** Balances at a moment, grouped the way the forecast's balance sheet shows them. */
export async function forecastOpening(db: Db, at: Date): Promise<ForecastOpening> {
  const rows = await db.$queryRaw<
    { type: string; group_code: number; category: string; total: bigint }[]
  >`
    SELECT a.type::text AS type, a.group_code, a.category::text AS category,
      COALESCE(SUM(l.amount_piastres), 0) AS total
    FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
    WHERE l.occurred_at < ${at}
    GROUP BY 1, 2, 3`;
  const o: ForecastOpening = { ...EMPTY_OPENING };
  for (const r of rows) {
    const v = Number(r.total);
    if (['bank', 'cash_box', 'store_cash'].includes(r.type)) o.cash += v;
    else if (r.type === 'rider_cash') o.riderCash += v;
    else if (r.group_code === 1600 || r.group_code === 1700) o.fixedAssets += v;
    else if (r.category === 'asset') o.otherAssets += v;
    else if (r.type === 'merchant') o.merchants -= v;
    else if (r.type === 'vat_payable') o.vatPayable -= v;
    else if (r.group_code === 2700) o.loans -= v;
    else if (r.category === 'liability') o.otherLiabilities -= v;
    else if (r.category === 'equity' && r.group_code !== 3400) o.capital -= v;
    // Retained earnings and every income and cost not closed into them yet.
    else o.retainedEarnings -= v;
  }
  return o;
}

// ─── the suggestion ───────────────────────────────────────────────────────────

export interface ForecastSuggestion {
  startMonth: string;
  /** The complete months read (oldest first); empty when the books hold nothing yet */
  basedOn: string[];
  opening: ForecastOpening;
  drivers: ForecastDriverRow[];
}

/**
 * The system's forecast from the last three complete Cairo months of the books (fewer when
 * the books are younger; zero drivers when they hold nothing): delivered orders and their
 * growth, fee income per delivered order by fee kind, cash orders and cash per order,
 * rider pay, office commission and packaging per order, salaries from the salary packages
 * in force, rent and every other income and cost account averaged (recurring expenses
 * instead where set up), loan instalments, depreciation of the asset register and VAT.
 */
export async function forecastSuggestion(
  db: Db,
  now: Date = new Date(),
): Promise<ForecastSuggestion> {
  const startMonth = cairoMonth(now);
  const months = forecastMonths(startMonth);
  const opening = await forecastOpening(db, monthStart(startMonth));

  // The complete months to read: the last three, none before the books began.
  const first = await db.$queryRaw<{ at: Date | null }[]>`
    SELECT LEAST(
      (SELECT MIN(occurred_at) FROM ledger_lines),
      (SELECT MIN(delivered_at) FROM orders WHERE status = 'delivered')) AS at`;
  const firstMonth = first[0]?.at ? cairoMonth(first[0].at) : null;
  const basedOn = firstMonth
    ? [-3, -2, -1].map((n) => forecastAddMonths(startMonth, n)).filter((m) => m >= firstMonth)
    : [];
  const drivers: ForecastDriverRow[] = [];
  const put = (month: string, key: string, value: number) => {
    if (value !== 0 && Number.isSafeInteger(value)) drivers.push({ month, key, value });
  };
  /** A level driver month by month: the first month, then each month it changes. */
  const putSeries = (key: string, values: number[]) =>
    values.forEach((v, i) => {
      if (i === 0) put(months[0]!, key, v);
      else if (v !== values[i - 1]) drivers.push({ month: months[i]!, key, value: v });
    });
  const m0 = startMonth;
  /** Average per month of an income or cost account over the months read (0 without any). */
  let averageOf: (accountId: string) => number = () => 0;
  let historyAccounts: { id: string; key: string | null }[] = [];

  const vatBp = await getSetting(db, 'fee.vat_bp');
  put(m0, 'vat_bp', vatBp);

  if (basedOn.length) {
    const from = monthStart(basedOn[0]!);
    const to = monthStart(startMonth);
    const n = basedOn.length;
    const orderRows = await db.$queryRaw<
      { month: string; orders: bigint; cod_orders: bigint; cod: bigint; merchants: bigint }[]
    >`
      SELECT to_char((delivered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
        COUNT(*) AS orders,
        COUNT(*) FILTER (WHERE cod_amount_piastres > 0) AS cod_orders,
        COALESCE(SUM(cod_amount_piastres), 0) AS cod,
        COUNT(DISTINCT merchant_id) AS merchants
      FROM orders
      WHERE status = 'delivered' AND delivered_at >= ${from} AND delivered_at < ${to}
      GROUP BY 1`;
    const perMonth = basedOn.map((m) => {
      const r = orderRows.find((x) => x.month === m);
      return {
        month: m,
        orders: Number(r?.orders ?? 0),
        codOrders: Number(r?.cod_orders ?? 0),
        cod: Number(r?.cod ?? 0),
        merchants: Number(r?.merchants ?? 0),
      };
    });
    const totalOrders = perMonth.reduce((s, r) => s + r.orders, 0);
    const totalCodOrders = perMonth.reduce((s, r) => s + r.codOrders, 0);
    const totalCod = perMonth.reduce((s, r) => s + r.cod, 0);
    const last = perMonth[perMonth.length - 1]!;

    // Growth: the average month on month change, where the month before had orders.
    const changes: number[] = [];
    for (let i = 1; i < perMonth.length; i++)
      if (perMonth[i - 1]!.orders > 0)
        changes.push(
          mulDiv(perMonth[i]!.orders - perMonth[i - 1]!.orders, 10_000, perMonth[i - 1]!.orders),
        );
    const growth = changes.length
      ? mulDiv(
          changes.reduce((s, c) => s + c, 0),
          1,
          changes.length,
        )
      : 0;
    put(m0, 'orders', mulDiv(last.orders, 10_000 + growth, 10_000));
    put(m0, 'growth_bp', growth);
    if (last.merchants) put(m0, 'orders_per_new_merchant', mulDiv(last.orders, 1, last.merchants));
    if (totalOrders) put(m0, 'cod_share_bp', mulDiv(totalCodOrders, 10_000, totalOrders));
    if (totalCodOrders) put(m0, 'cod_per_order', mulDiv(totalCod, 1, totalCodOrders));

    // Income and costs of the months read, per account (and per fee kind on fee income).
    const lineRows = await db.$queryRaw<
      {
        id: string;
        key: string | null;
        category: string;
        kind: string;
        month: string;
        total: bigint;
      }[]
    >`
      SELECT a.id, a.key, a.category::text AS category, e.kind,
        to_char((l.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
        SUM(l.amount_piastres) AS total
      FROM ledger_lines l
        JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE l.occurred_at >= ${from} AND l.occurred_at < ${to}
        AND a.category IN ('revenue', 'expense') AND e.kind <> 'year_close'
      GROUP BY 1, 2, 3, 4, 5`;
    // Income is credit (negative): shown positive like the profit and loss.
    const amount = (r: (typeof lineRows)[number]) =>
      r.category === 'revenue' ? -Number(r.total) : Number(r.total);
    const sumWhere = (f: (r: (typeof lineRows)[number]) => boolean) =>
      lineRows.filter(f).reduce((s, r) => s + amount(r), 0);

    const feeKinds = [...new Set(lineRows.filter((r) => r.key === 'revenue').map((r) => r.kind))];
    if (totalOrders)
      for (const kind of feeKinds.sort()) {
        const total = sumWhere((r) => r.key === 'revenue' && r.kind === kind);
        put(m0, `fee:${kind}`, mulDiv(total, 1, totalOrders));
      }
    const lastFees = sumWhere((r) => r.key === 'revenue' && r.month === last.month);
    const perOrder = (key: string) =>
      totalOrders
        ? mulDiv(
            sumWhere((r) => r.key === key),
            1,
            totalOrders,
          )
        : 0;
    put(m0, 'rider_pay_per_order', perOrder('rider_bonus_expense'));
    put(m0, 'office_commission_per_order', perOrder('rider_office_commission'));
    put(m0, 'packaging_per_order', perOrder('expense:packaging'));
    averageOf = (accountId) =>
      mulDiv(
        sumWhere((r) => r.id === accountId),
        1,
        n,
      );
    historyAccounts = lineRows.map((r) => ({ id: r.id, key: r.key }));

    // VAT claimed back on purchases, per month on average.
    const input = await db.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(l.amount_piastres), 0) AS total
      FROM ledger_lines l
        JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.key = 'vat_payable' AND e.kind = ANY(${VAT_PURCHASE_KINDS})
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}`;
    put(m0, 'vat_input', mulDiv(Number(input[0]?.total ?? 0), 1, n));

    // Merchants owed: how many days of the last month's net cash the balance holds.
    const lastNet = last.cod - lastFees - mulDiv(lastFees, vatBp, 10_000);
    const days = daysInMonth(last.month);
    if (lastNet > 0 && opening.merchants > 0)
      put(m0, 'merchant_hold_days', Math.min(days, mulDiv(opening.merchants, days, lastNet)));
  }

  // Rent, salaries and every other income and cost account: the average of the months read,
  // except months a recurring expense covers, which take its amount.
  const recurring = await recurringByMonth(db, months);
  const series = (accountId: string | undefined) => {
    const avg = accountId ? averageOf(accountId) : 0;
    const known = accountId ? recurring.get(accountId) : undefined;
    return months.map((m) => known?.get(m) ?? avg);
  };
  const rent = await db.ledgerAccount.findUnique({ where: { key: 'expense:rent' } });
  putSeries('rent', series(rent?.id));
  const salaryAccount = await db.ledgerAccount.findUnique({
    where: { key: 'expense:salaries' },
  });
  const salaries = await salariesInForce(db, cairoDay(now));
  put(m0, 'salaries', salaries || (salaryAccount ? averageOf(salaryAccount.id) : 0));
  const fixedIds = new Set(
    historyAccounts.filter((a) => !a.key || !DRIVER_ACCOUNT_KEYS.has(a.key)).map((a) => a.id),
  );
  for (const id of recurring.keys()) if (id !== rent?.id) fixedIds.add(id);
  for (const id of [...fixedIds].sort()) putSeries(`fixed:${id}`, series(id));

  // Known schedules: loan instalments still unpaid and the asset register's depreciation.
  const instalments = await db.loanInstalment.findMany({
    where: {
      paidAt: null,
      loan: { status: 'active' },
      dueDay: { lt: monthStart(forecastAddMonths(startMonth, FORECAST_MONTHS)) },
    },
    select: { dueDay: true, principalPiastres: true, interestPiastres: true },
  });
  const principal = new Map<string, number>();
  const interest = new Map<string, number>();
  for (const i of instalments) {
    // Overdue instalments are expected in the first month.
    const m = [m0, i.dueDay.toISOString().slice(0, 7)].sort()[1]!;
    principal.set(m, (principal.get(m) ?? 0) + i.principalPiastres);
    interest.set(m, (interest.get(m) ?? 0) + i.interestPiastres);
  }
  const assets = await db.fixedAsset.findMany({ where: { disposedAt: null } });
  for (const m of months) {
    put(m, 'loan_principal', principal.get(m) ?? 0);
    put(m, 'loan_interest', interest.get(m) ?? 0);
    let depreciation = 0;
    for (const a of assets) {
      const i = monthIndex(a.startMonth, m);
      if (i >= 0 && i < a.lifeMonths)
        depreciation += monthlyPart(a.costPiastres - a.salvagePiastres, a.lifeMonths, i);
    }
    put(m, 'depreciation', depreciation);
  }
  return { startMonth, basedOn, opening, drivers };
}

function monthIndex(from: string, m: string) {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return (y - fy) * 12 + (mm - fm);
}

/** Active recurring expenses per expense account and month they cover, net of VAT. */
async function recurringByMonth(db: Db, months: string[]) {
  const rows = await db.recurringEntry.findMany({ where: { isActive: true } });
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const p = r.payload as { expenseAccountId?: string; vatPiastres?: number };
    if (!p.expenseAccountId) continue;
    const net = r.amountPiastres - (p.vatPiastres ?? 0);
    const byMonth = out.get(p.expenseAccountId) ?? new Map<string, number>();
    for (const m of months)
      if (m >= r.startMonth && (!r.endMonth || m <= r.endMonth))
        byMonth.set(m, (byMonth.get(m) ?? 0) + net);
    out.set(p.expenseAccountId, byMonth);
  }
  return out;
}

/** The monthly gross of every salaried employee from the package in force on a day. */
async function salariesInForce(db: Db, day: string) {
  const people = await db.employee.findMany({
    where: {
      employment: 'employee',
      payBasis: 'monthly_salary',
      status: { in: ['active', 'on_leave', 'suspended'] },
    },
    select: { id: true },
  });
  let total = 0;
  for (const p of people) {
    const pkg = await packageInForce(db, p.id, day);
    if (pkg) total += packageGross(pkg);
  }
  return total;
}

// ─── scenarios ────────────────────────────────────────────────────────────────

const userRef = { select: { id: true, name: true } } as const;

async function nextForecastNumber(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('number:forecasts'))`;
  const top = await tx.forecast.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

/** Income and cost accounts a forecast line may name (fixed:<id>). */
async function lineAccounts(db: Db) {
  const rows = await db.ledgerAccount.findMany({
    where: { category: { in: ['revenue', 'expense'] } },
    select: {
      id: true,
      key: true,
      code: true,
      nameEn: true,
      nameAr: true,
      category: true,
      isActive: true,
    },
    orderBy: { code: 'asc' },
  });
  return rows.map((a) => ({ ...a, category: a.category as 'revenue' | 'expense' }));
}

async function loadForecast(db: Db, id: string) {
  const f = await db.forecast.findUnique({
    where: { id },
    include: {
      drivers: { select: { month: true, key: true, value: true } },
      overrides: {
        select: {
          month: true,
          lineKey: true,
          amountPiastres: true,
          note: true,
          updatedAt: true,
          updatedBy: userRef,
        },
      },
      createdBy: userRef,
      approvedBy: userRef,
      copiedFrom: { select: { id: true, number: true, name: true } },
    },
  });
  if (!f) throw new DomainError('forecast_not_found', 404);
  return f;
}

type Loaded = Awaited<ReturnType<typeof loadForecast>>;

function computeOf(f: Loaded, accounts: { id: string; category: 'revenue' | 'expense' }[]) {
  return forecastCompute({
    startMonth: f.startMonth,
    drivers: f.drivers,
    overrides: f.overrides,
    opening: { ...EMPTY_OPENING, ...(f.opening as unknown as Partial<ForecastOpening>) },
    accounts,
  });
}

function summary(result: ForecastResult) {
  const lastMonth = result.months[result.months.length - 1]!;
  return {
    revenuePiastres: result.months.reduce((s, m) => s + m.revenue, 0),
    profitPiastres: result.months.reduce((s, m) => s + m.profit, 0),
    orders: result.months.reduce((s, m) => s + m.orders, 0),
    cashEndPiastres: lastMonth.balanceSheet.cash,
    lowestCashPiastres: Math.min(...result.months.map((m) => m.balanceSheet.cash)),
    warnings: result.warnings.length,
  };
}

const head = (f: Loaded) => ({
  id: f.id,
  number: forecastNumber(f.number),
  name: f.name,
  status: f.status,
  startMonth: f.startMonth,
  basedOnFrom: f.basedOnFrom,
  basedOnTo: f.basedOnTo,
  createdBy: f.createdBy,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  approvedBy: f.approvedBy,
  approvedAt: f.approvedAt,
  copiedFrom: f.copiedFrom
    ? { ...f.copiedFrom, number: forecastNumber(f.copiedFrom.number) }
    : null,
});

/** Every scenario, newest first, with its year in a few numbers. */
export async function listForecasts(db: Db) {
  const ids = await db.forecast.findMany({ select: { id: true }, orderBy: { number: 'desc' } });
  const accounts = await lineAccounts(db);
  const out = [];
  for (const { id } of ids) {
    const f = await loadForecast(db, id);
    out.push({ ...head(f), ...summary(computeOf(f, accounts)) });
  }
  return out;
}

/** One scenario: its drivers, overrides (who and why), accounts and the computed months. */
export async function forecastDetail(db: Db, id: string) {
  const [f, accounts] = await Promise.all([loadForecast(db, id), lineAccounts(db)]);
  const result = computeOf(f, accounts);
  return {
    forecast: head(f),
    opening: { ...EMPTY_OPENING, ...(f.opening as unknown as Partial<ForecastOpening>) },
    months: forecastMonths(f.startMonth),
    drivers: f.drivers,
    overrides: f.overrides,
    accounts,
    result,
    summary: summary(result),
  };
}

/** Starts a scenario from the system's suggestion, or as a copy of another one. */
export async function createForecast(
  db: Db,
  input: { name: string; copyFromId?: string; actorUserId: string; now?: Date },
) {
  const source = input.copyFromId ? await loadForecast(db, input.copyFromId) : null;
  const suggestion = source ? null : await forecastSuggestion(db, input.now ?? new Date());
  return inTransaction(db, async (tx) => {
    const number = await nextForecastNumber(tx);
    const f = await tx.forecast.create({
      data: {
        number,
        name: input.name.trim(),
        startMonth: source?.startMonth ?? suggestion!.startMonth,
        basedOnFrom: source ? source.basedOnFrom : (suggestion!.basedOn[0] ?? null),
        basedOnTo: source ? source.basedOnTo : (suggestion!.basedOn.at(-1) ?? null),
        opening: (source?.opening ?? suggestion!.opening) as unknown as Prisma.InputJsonValue,
        copiedFromId: source?.id ?? null,
        createdById: input.actorUserId,
      },
    });
    const drivers = source?.drivers ?? suggestion!.drivers;
    if (drivers.length)
      await tx.forecastDriver.createMany({
        data: drivers.map((d) => ({ ...d, forecastId: f.id, updatedById: input.actorUserId })),
      });
    if (source?.overrides.length)
      await tx.forecastOverride.createMany({
        data: source.overrides.map((o) => ({
          forecastId: f.id,
          month: o.month,
          lineKey: o.lineKey,
          amountPiastres: o.amountPiastres,
          note: o.note,
          updatedById: o.updatedBy.id,
        })),
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.forecast_create',
      entityType: 'forecast',
      entityId: f.id,
      after: {
        number: forecastNumber(number),
        name: f.name,
        startMonth: f.startMonth,
        from: source ? { copy: forecastNumber(source.number) } : { suggestion: f.basedOnTo },
        drivers: drivers.length,
      },
    });
    return f;
  });
}

async function editable(tx: Tx, id: string) {
  const f = await tx.forecast.findUnique({ where: { id } });
  if (!f) throw new DomainError('forecast_not_found', 404);
  if (f.status !== 'draft') throw new DomainError('forecast_approved');
  return f;
}

function inHorizon(startMonth: string, month: string) {
  return forecastMonths(startMonth).includes(month);
}

/** Sets or clears drivers of a draft scenario (one transaction, audited). */
export function saveForecastDrivers(
  db: Db,
  input: {
    forecastId: string;
    changes: { month: string; key: string; value: number | null }[];
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const f = await editable(tx, input.forecastId);
    const changed: { month: string; key: string; before: number | null; after: number | null }[] =
      [];
    for (const c of input.changes) {
      if (!inHorizon(f.startMonth, c.month)) throw new DomainError('month_outside_forecast', 400);
      if (!isForecastDriverKey(c.key)) throw new DomainError('invalid_driver', 400);
      const where = {
        forecastId_month_key: { forecastId: f.id, month: c.month, key: c.key },
      };
      const before = await tx.forecastDriver.findUnique({ where });
      if (c.value === null) {
        if (before) await tx.forecastDriver.delete({ where });
      } else if (!before || before.value !== c.value) {
        await tx.forecastDriver.upsert({
          where,
          update: { value: c.value, updatedById: input.actorUserId, updatedAt: new Date() },
          create: {
            forecastId: f.id,
            month: c.month,
            key: c.key,
            value: c.value,
            updatedById: input.actorUserId,
          },
        });
      }
      if ((before?.value ?? null) !== c.value)
        changed.push({ month: c.month, key: c.key, before: before?.value ?? null, after: c.value });
    }
    if (changed.length) {
      await tx.forecast.update({ where: { id: f.id }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'finance.forecast_edit',
        entityType: 'forecast',
        entityId: f.id,
        after: { drivers: changed.slice(0, 200) },
      });
    }
    return { changed: changed.length };
  });
}

/** Sets or clears line overrides of a draft scenario (one transaction, audited). */
export function saveForecastOverrides(
  db: Db,
  input: {
    forecastId: string;
    changes: { month: string; lineKey: string; amountPiastres: number | null; note?: string }[];
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const f = await editable(tx, input.forecastId);
    const changed: {
      month: string;
      line: string;
      before: number | null;
      after: number | null;
      note: string | null;
    }[] = [];
    for (const c of input.changes) {
      if (!inHorizon(f.startMonth, c.month)) throw new DomainError('month_outside_forecast', 400);
      if (!isForecastLineKey(c.lineKey)) throw new DomainError('invalid_line', 400);
      if (c.lineKey.startsWith('fixed:')) {
        const account = await tx.ledgerAccount.findUnique({ where: { id: c.lineKey.slice(6) } });
        if (!account || !['revenue', 'expense'].includes(account.category))
          throw new DomainError('account_not_found', 404);
      }
      const where = {
        forecastId_month_lineKey: { forecastId: f.id, month: c.month, lineKey: c.lineKey },
      };
      const before = await tx.forecastOverride.findUnique({ where });
      const note = c.note?.trim() || null;
      if (c.amountPiastres === null) {
        if (before) await tx.forecastOverride.delete({ where });
      } else {
        await tx.forecastOverride.upsert({
          where,
          update: {
            amountPiastres: c.amountPiastres,
            note,
            updatedById: input.actorUserId,
            updatedAt: new Date(),
          },
          create: {
            forecastId: f.id,
            month: c.month,
            lineKey: c.lineKey,
            amountPiastres: c.amountPiastres,
            note,
            updatedById: input.actorUserId,
          },
        });
      }
      if ((before?.amountPiastres ?? null) !== c.amountPiastres || (before?.note ?? null) !== note)
        changed.push({
          month: c.month,
          line: c.lineKey,
          before: before?.amountPiastres ?? null,
          after: c.amountPiastres,
          note,
        });
    }
    if (changed.length) {
      await tx.forecast.update({ where: { id: f.id }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'finance.forecast_edit',
        entityType: 'forecast',
        entityId: f.id,
        after: { overrides: changed },
      });
    }
    return { changed: changed.length };
  });
}

export function renameForecast(
  db: Db,
  input: { forecastId: string; name: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const f = await tx.forecast.findUnique({ where: { id: input.forecastId } });
    if (!f) throw new DomainError('forecast_not_found', 404);
    const name = input.name.trim();
    if (name === f.name) return f;
    const row = await tx.forecast.update({ where: { id: f.id }, data: { name } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.forecast_rename',
      entityType: 'forecast',
      entityId: f.id,
      before: { name: f.name },
      after: { name },
    });
    return row;
  });
}

/** Approves a draft (accounting manage) or opens an approved one again for editing. */
export function setForecastStatus(
  db: Db,
  input: { forecastId: string; status: 'approved' | 'draft'; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const f = await tx.forecast.findUnique({ where: { id: input.forecastId } });
    if (!f) throw new DomainError('forecast_not_found', 404);
    if (f.status === input.status)
      throw new DomainError(input.status === 'approved' ? 'forecast_approved' : 'forecast_draft');
    const approved = input.status === 'approved';
    const row = await tx.forecast.update({
      where: { id: f.id },
      data: {
        status: input.status,
        approvedById: approved ? input.actorUserId : null,
        approvedAt: approved ? new Date() : null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: approved ? 'finance.forecast_approve' : 'finance.forecast_reopen',
      entityType: 'forecast',
      entityId: f.id,
      before: { status: f.status },
      after: { status: input.status },
    });
    return row;
  });
}

/** Deletes a draft scenario with its drivers and overrides (the audit log keeps it). */
export function deleteForecast(db: Db, input: { forecastId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const f = await editable(tx, input.forecastId);
    await tx.forecast.delete({ where: { id: f.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.forecast_delete',
      entityType: 'forecast',
      entityId: f.id,
      before: { number: forecastNumber(f.number), name: f.name },
    });
  });
}

/** Several scenarios side by side: each month's profit and cash, and the year. */
export async function compareForecasts(db: Db, ids: string[]) {
  const accounts = await lineAccounts(db);
  const out = [];
  for (const id of [...new Set(ids)].slice(0, 6)) {
    const f = await loadForecast(db, id);
    const result = computeOf(f, accounts);
    out.push({
      ...head(f),
      ...summary(result),
      months: result.months.map((m) => ({
        month: m.month,
        orders: m.orders,
        revenue: m.revenue,
        expenses: m.expenses,
        profit: m.profit,
        cashEnd: m.balanceSheet.cash,
      })),
    });
  }
  return out;
}

// ─── use as budget ────────────────────────────────────────────────────────────

/** The budget rows a scenario would write (company wide), next to what is there now. */
export async function forecastBudgetPreview(db: Db, id: string) {
  const [f, accounts] = await Promise.all([loadForecast(db, id), lineAccounts(db)]);
  const result = computeOf(f, accounts);
  const byKey = new Map(accounts.filter((a) => a.key).map((a) => [a.key!, a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // Lines whose system account does not exist yet carry its key, opened on apply.
  const rows = forecastBudgetRows(result, (lineKey) => {
    const ref = forecastLineAccount(lineKey);
    if (!ref) return null;
    if ('id' in ref) return byId.has(ref.id) ? ref.id : null;
    return byKey.get(ref.key)?.id ?? `key:${ref.key}`;
  });
  const existing = await db.budget.findMany({
    where: { darkStoreId: null, month: { in: result.months.map((m) => m.month) } },
  });
  const out = rows.map((r) => {
    const account = r.accountId.startsWith('key:') ? null : byId.get(r.accountId)!;
    const before = account
      ? existing.find((b) => b.month === r.month && b.accountId === account.id)
      : undefined;
    const accountKey = r.accountId.startsWith('key:') ? r.accountId.slice(4) : account!.key;
    return {
      month: r.month,
      accountId: account?.id ?? null,
      accountKey,
      code: account?.code ?? null,
      nameEn: account?.nameEn ?? null,
      nameAr: account?.nameAr ?? null,
      category:
        account?.category ??
        (accountKey === 'revenue' ? ('revenue' as const) : ('expense' as const)),
      amountPiastres: r.amountPiastres,
      existingPiastres: before?.amountPiastres ?? null,
    };
  });
  return {
    forecast: head(f),
    months: result.months.map((m) => m.month),
    rows: out,
    existing: out.filter((r) => r.existingPiastres !== null).length,
    negative: out.filter((r) => r.amountPiastres < 0).length,
  };
}

/**
 * Writes an approved scenario's income and expense accounts per month into the budgets
 * (company wide) through setBudget, all in one transaction. Rows that already hold a budget
 * are replaced or skipped as asked; a negative amount is never a budget and is skipped.
 */
export async function forecastToBudget(
  db: Db,
  input: { forecastId: string; mode: 'replace' | 'skip'; actorUserId: string },
) {
  const preview = await forecastBudgetPreview(db, input.forecastId);
  if (preview.forecast.status !== 'approved') throw new DomainError('forecast_not_approved');
  return inTransaction(db, async (tx) => {
    let written = 0;
    let skippedExisting = 0;
    let skippedNegative = 0;
    let skippedNoAccount = 0;
    for (const r of preview.rows) {
      if (r.amountPiastres < 0) {
        skippedNegative++;
        continue;
      }
      if (r.existingPiastres !== null && input.mode === 'skip') {
        skippedExisting++;
        continue;
      }
      // Nothing planned and nothing there: no row to write.
      if (r.existingPiastres === null && r.amountPiastres === 0) continue;
      let accountId = r.accountId;
      if (!accountId && r.accountKey && SYSTEM_LINE_KEYS.has(r.accountKey))
        accountId = await accountIdOf(tx, { type: r.accountKey as SystemAccountKey });
      if (!accountId) {
        skippedNoAccount++;
        continue;
      }
      await setBudget(tx, {
        month: r.month,
        accountId,
        darkStoreId: null,
        amountPiastres: r.amountPiastres,
        actorUserId: input.actorUserId,
      });
      written++;
    }
    const result = { written, skippedExisting, skippedNegative, skippedNoAccount };
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.forecast_to_budget',
      entityType: 'forecast',
      entityId: input.forecastId,
      after: {
        number: preview.forecast.number,
        mode: input.mode,
        from: preview.months[0] ?? null,
        to: preview.months.at(-1) ?? null,
        ...result,
      },
    });
    return result;
  });
}
