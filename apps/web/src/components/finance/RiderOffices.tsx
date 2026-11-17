'use client';

import { billNumber, cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import type {
  OfficeAccountDay,
  OfficeBillResult,
  RiderOfficeDetail as Detail,
  RiderOfficeAccount,
  RiderOfficeList,
  SupplierRow,
} from '@/lib/finance-types';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';
import { StatusPill } from '@/components/StatusPill';

// Rider supply offices (Accounting > Money out > Rider offices): offices supply riders and earn
// a commission on each rider's pay per delivered order. Accounting view reads, use prepares the
// monthly bills, manage marks offices and sets their rate.

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const thEnd = `${th} text-end`;
const td = 'px-3 py-2';
const tdEnd = `${td} text-end`;

const percent = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, '')}%`;
/** "20" or "12.5" percent typed → basis points; null when not a percent. */
const percentToBp = (text: string) => {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) return null;
  const [whole, part = ''] = text.trim().split('.');
  const bp = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
};
const lastMonth = () => {
  const [y, m] = cairoDay(new Date()).slice(0, 7).split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) - 1;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <p className="text-caption text-text-muted">{label}</p>
      <p className="mt-1 text-body">{children}</p>
    </div>
  );
}

/** What we owe the office, or what it owes us (shown apart, in red). */
function Balance({ owed }: { owed: number }) {
  const t = useTranslations('riderOffices');
  if (owed >= 0) return <Amount piastres={owed} strong />;
  return (
    <span className="text-danger">
      {t('owesUs')} <Amount piastres={-owed} strong />
    </span>
  );
}

/** The results of a "Prepare office bills" run, one line per office. */
function Results({ results }: { results: OfficeBillResult[] }) {
  const t = useTranslations('riderOffices');
  const te = useTranslations('finance.merchants.errors');
  if (results.length === 0) return <p className="text-body-sm text-text-muted">{t('noOffices')}</p>;
  return (
    <ul className="space-y-1 text-body-sm">
      {results.map((r) => (
        <li key={r.supplierId}>
          <span className="font-bold">{r.name}</span>:{' '}
          {r.status === 'refused'
            ? te.has(r.error ?? '')
              ? te(r.error!)
              : te('generic')
            : t(`results.${r.status}`, {
                bill: r.billLabel ?? '',
                total: (r.totalPiastres / 100).toFixed(2),
                shortages: (r.shortagesPiastres / 100).toFixed(2),
              })}
        </li>
      ))}
    </ul>
  );
}

/** Prepares the bills of a month that is over: every office, or one. */
function PrepareBills({ month, supplierId }: { month: string; supplierId?: string }) {
  const t = useTranslations('riderOffices');
  const action = useFinanceAction();
  const [results, setResults] = useState<OfficeBillResult[] | null>(null);
  const over = month < cairoDay(new Date()).slice(0, 7);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={supplierId ? secondary : primary}
        disabled={action.busy || !over}
        onClick={async () => {
          const data = await action.send<{ offices: OfficeBillResult[] }>(
            'POST',
            '/finance/rider-offices/prepare-bills',
            { month, supplierId },
            () => t('prepared'),
          );
          if (data) setResults(data.offices);
        }}
      >
        {supplierId ? t('prepareBill') : t('prepareBills', { month })}
      </button>
      {!over && !supplierId && <p className="text-caption text-text-muted">{t('monthNotOver')}</p>}
      <ActionMessage message={action.message} />
      {results && <Results results={results} />}
    </div>
  );
}

/** Marks a supplier as a rider office with its commission (accounting manage). */
function AddOffice({ suppliers }: { suppliers: SupplierRow[] }) {
  const t = useTranslations('riderOffices');
  const action = useFinanceAction();
  const [supplierId, setSupplierId] = useState('');
  const [rate, setRate] = useState('');
  const bp = percentToBp(rate);
  const choices = suppliers.filter((s) => s.isActive && !s.isRiderOffice);
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('addTitle')}</h2>
      <p className="text-caption text-text-muted">{t('addHint')}</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="block text-caption">
          {t('supplier')}
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={`${field} mt-1`}
          >
            <option value="">–</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('commissionPercent')}
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder="20"
            className={`${field} mt-1 text-end`}
          />
        </label>
        <button
          type="button"
          className={primary}
          disabled={action.busy || !supplierId || bp === null}
          onClick={() =>
            void action.send('PATCH', `/finance/rider-offices/${supplierId}`, {
              isRiderOffice: true,
              commissionBp: bp,
            })
          }
        >
          {t('add')}
        </button>
      </div>
      <ActionMessage message={action.message} />
    </section>
  );
}

/** The list: every office with this month's figures, and the month's bills. */
export function RiderOfficesView({
  data,
  suppliers,
  canUse,
  canManage,
}: {
  data: RiderOfficeList;
  suppliers: SupplierRow[];
  canUse: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('riderOffices');
  const router = useRouter();
  const rows = data.rows;
  const total = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <label className="text-caption">
          {t('month')}
          <input
            type="month"
            value={data.month}
            onChange={(e) => e.target.value && router.push(`?month=${e.target.value}`)}
            dir="ltr"
            className={`${field} mt-1 block w-44`}
          />
        </label>
        {canUse && <PrepareBills month={data.month} />}
        {canUse && data.month >= cairoDay(new Date()).slice(0, 7) && (
          <Link href={`?month=${lastMonth()}`} className="text-body-sm text-link">
            {t('openLastMonth')}
          </Link>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <>
          {/* Phones: one card per office */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/finance/rider-offices/${r.id}`} className="font-bold text-link">
                    {r.name}
                  </Link>
                  <span className="ltr-iso text-body-sm">{percent(r.commissionBp)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm">
                  <dt className="text-text-muted">{t('riders')}</dt>
                  <dd className="text-end">{r.riders}</dd>
                  <dt className="text-text-muted">{t('deliveries')}</dt>
                  <dd className="text-end">{r.deliveries}</dd>
                  <dt className="text-text-muted">{t('commission')}</dt>
                  <dd className="text-end">
                    <Amount piastres={r.commissionPiastres} />
                  </dd>
                  <dt className="text-text-muted">{t('shortages')}</dt>
                  <dd className="text-end">
                    <Amount piastres={r.shortagesPiastres} />
                  </dd>
                  <dt className="text-text-muted">{t('balance')}</dt>
                  <dd className="text-end">
                    <Balance owed={r.owedPiastres} />
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table
              head={
                <>
                  <th className={th}>{t('office')}</th>
                  <th className={thEnd}>{t('rate')}</th>
                  <th className={thEnd}>{t('riders')}</th>
                  <th className={thEnd}>{t('deliveries')}</th>
                  <th className={thEnd}>{t('commission')}</th>
                  <th className={thEnd}>{t('shortages')}</th>
                  <th className={th}>{t('bill')}</th>
                  <th className={thEnd}>{t('balance')}</th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-line ${r.isActive ? '' : 'opacity-60'}`}>
                  <td className={td}>
                    <Link href={`/finance/rider-offices/${r.id}`} className="text-link">
                      {r.name}
                    </Link>
                    {!r.taxId && (
                      <span className="ms-2 text-caption text-text-muted">{t('noTaxId')}</span>
                    )}
                  </td>
                  <td className={`${tdEnd} ltr-iso`}>{percent(r.commissionBp)}</td>
                  <td className={tdEnd}>{r.riders}</td>
                  <td className={tdEnd}>{r.deliveries}</td>
                  <td className={tdEnd}>
                    <Amount piastres={r.commissionPiastres} />
                  </td>
                  <td className={tdEnd}>
                    <Amount piastres={r.shortagesPiastres} />
                  </td>
                  <td className={td}>
                    {r.bill ? (
                      <Link href={`/finance/bills/${r.bill.id}`} className="ltr-iso text-link">
                        {billNumber(r.bill.number)}
                      </Link>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className={tdEnd}>
                    <Balance owed={r.owedPiastres} />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line font-bold">
                <td className={td}>{t('total')}</td>
                <td className={td} />
                <td className={tdEnd}>{total((r) => r.riders)}</td>
                <td className={tdEnd}>{total((r) => r.deliveries)}</td>
                <td className={tdEnd}>
                  <Amount piastres={total((r) => r.commissionPiastres)} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={total((r) => r.shortagesPiastres)} />
                </td>
                <td className={td} />
                <td className={tdEnd}>
                  <Amount piastres={total((r) => r.owedPiastres)} />
                </td>
              </tr>
            </Table>
          </div>
        </>
      )}
      <p className="text-caption text-text-muted">{t('howItWorks')}</p>
      {canManage && <AddOffice suppliers={suppliers} />}
    </div>
  );
}

/** Changes an office's commission (accounting manage); later deliveries take the new rate. */
function RateEditor({ office }: { office: Detail['office'] }) {
  const t = useTranslations('riderOffices');
  const action = useFinanceAction();
  const [rate, setRate] = useState(String(office.commissionBp / 100));
  const bp = percentToBp(rate);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-caption">
          {t('commissionPercent')}
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className={`${field} mt-1 w-28 text-end`}
          />
        </label>
        <button
          type="button"
          className={secondary}
          disabled={action.busy || bp === null || bp === office.commissionBp}
          onClick={() =>
            void action.send('PATCH', `/finance/rider-offices/${office.id}`, { commissionBp: bp })
          }
        >
          {t('saveRate')}
        </button>
      </div>
      <p className="text-caption text-text-muted">{t('rateHint')}</p>
      <ActionMessage message={action.message} />
    </div>
  );
}

/** One office: its rate, wallet, riders, the last 12 months and its bills. */
export function RiderOfficeView({
  data,
  canUse,
  canManage,
  account,
}: {
  data: Detail;
  canUse: boolean;
  canManage: boolean;
  /** The daily account section, read on the server for the month in the address */
  account?: ReactNode;
}) {
  const t = useTranslations('riderOffices');
  const locale = useLocale();
  const { office, wallet } = data;
  const firstOpen = [...data.months].reverse().find((m) => m.over && !m.bill);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('rate')}>
          <span className="ltr-iso font-bold">{percent(office.commissionBp)}</span>
        </Stat>
        <Stat label={t('balance')}>
          <Balance owed={wallet.owedPiastres} />
        </Stat>
        <Stat label={t('unbilled')}>
          <Amount piastres={wallet.unbilledPiastres} />
        </Stat>
        <Stat label={t('openBills')}>
          {wallet.openBills} · <Amount piastres={wallet.openBillsPiastres} />
        </Stat>
      </div>
      {wallet.owesUsPiastres > 0 && (
        <p className="rounded-md bg-surface-raised px-3 py-2 text-body-sm">
          {t('owesUsHint', { amount: (wallet.owesUsPiastres / 100).toFixed(2) })}
        </p>
      )}
      {canManage && <RateEditor office={office} />}

      {account}

      <section className="space-y-2">
        <h2 className="text-h3">{t('ridersTitle')}</h2>
        {data.riders.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noRiders')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('rider')}</th>
                <th className={th}>{t('store')}</th>
                <th className={thEnd}>{t('deliveriesThisMonth')}</th>
                <th className={thEnd}>{t('commissionThisMonth')}</th>
                <th className={thEnd}>{t('riderWallet')}</th>
                <th className={thEnd}>{t('riderOwes')}</th>
              </>
            }
          >
            {data.riders.map((r) => (
              <tr key={r.riderId} className="border-t border-line">
                <td className={td}>
                  <Link href={`/admin/hr/${r.employeeId}`} className="text-link">
                    {locale === 'ar' && r.nameAr ? r.nameAr : r.name}
                  </Link>
                  <span className="ms-2 ltr-iso text-caption text-text-muted">{r.badgeCode}</span>
                  {r.status === 'left' && (
                    <span className="ms-2 text-caption text-text-muted">{t('left')}</span>
                  )}
                </td>
                <td className={`${td} ltr-iso`}>{r.darkStore.code}</td>
                <td className={tdEnd}>{r.deliveriesThisMonth}</td>
                <td className={tdEnd}>
                  <Amount piastres={r.commissionThisMonthPiastres} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={r.walletPiastres} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={r.owesPiastres} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3">{t('monthsTitle')}</h2>
          {canUse && firstOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm">{firstOpen.month}</span>
              <PrepareBills month={firstOpen.month} supplierId={office.id} />
            </div>
          )}
        </div>
        <Table
          head={
            <>
              <th className={th}>{t('month')}</th>
              <th className={thEnd}>{t('deliveries')}</th>
              <th className={thEnd}>{t('riderPay')}</th>
              <th className={thEnd}>{t('commission')}</th>
              <th className={thEnd}>{t('shortages')}</th>
              <th className={th}>{t('bill')}</th>
            </>
          }
        >
          {data.months.map((m) => (
            <tr key={m.month} className="border-t border-line">
              <td className={`${td} ltr-iso`}>{m.month}</td>
              <td className={tdEnd}>{m.deliveries}</td>
              <td className={tdEnd}>
                <Amount piastres={m.riderPayPiastres} />
              </td>
              <td className={tdEnd}>
                <Amount piastres={m.commissionPiastres} />
              </td>
              <td className={tdEnd}>
                <Amount piastres={m.shortagesPiastres} />
              </td>
              <td className={td}>
                {m.bill ? (
                  <Link href={`/finance/bills/${m.bill.id}`} className="ltr-iso text-link">
                    {billNumber(m.bill.number)}
                  </Link>
                ) : m.over ? (
                  <span className="text-text-muted">{t('notPrepared')}</span>
                ) : (
                  <span className="text-text-muted">{t('running')}</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-h3">{t('billsTitle')}</h2>
        {data.bills.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noBills')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('bill')}</th>
                <th className={th}>{t('month')}</th>
                <th className={thEnd}>{t('net')}</th>
                <th className={thEnd}>{t('vat')}</th>
                <th className={thEnd}>{t('billTotal')}</th>
                <th className={thEnd}>{t('leftToPay')}</th>
                <th className={th}>{t('status')}</th>
              </>
            }
          >
            {data.bills.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className={td}>
                  <Link href={`/finance/bills/${b.id}`} className="ltr-iso text-link">
                    {billNumber(b.number)}
                  </Link>
                </td>
                <td className={`${td} ltr-iso`}>{b.officeMonth ?? b.reference}</td>
                <td className={tdEnd}>
                  <Amount piastres={b.netPiastres} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={b.vatPiastres} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={b.totalPiastres} />
                </td>
                <td className={tdEnd}>
                  <Amount piastres={b.leftPiastres} />
                </td>
                <td className={td}>
                  <StatusPill status={b.status}>{t(`statuses.${b.status}`)}</StatusPill>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

/** A movement of what we owe: plain when it goes up, "−" in red when it goes down. */
function Move({ piastres, down = false }: { piastres: number; down?: boolean }) {
  if (piastres === 0) return <span className="text-text-muted">–</span>;
  return (
    <span className={down ? 'text-danger' : undefined}>
      {down ? '−' : ''}
      <Amount piastres={piastres} />
    </span>
  );
}

const moved = (d: Omit<OfficeAccountDay, 'day' | 'balancePiastres'>) =>
  d.deliveries > 0 ||
  d.commissionPiastres !== 0 ||
  d.shortagesPiastres !== 0 ||
  d.billedPiastres !== 0 ||
  d.paymentsPiastres !== 0 ||
  d.otherPiastres !== 0;

/**
 * The office's account day by day for a month: commission booked at each delivery raises what
 * we owe, shortages moved and payments lower it, the monthly bill adds its VAT. Oldest day
 * first, opening with the balance before the month, totals and a CSV.
 */
export function OfficeAccountView({ account }: { account: RiderOfficeAccount }) {
  const t = useTranslations('riderOffices.account');
  const locale = useLocale();
  const router = useRouter();
  const thisMonth = cairoDay(new Date()).slice(0, 7);
  const active = account.days.filter(moved);
  const [all, setAll] = useState(false);
  const shown = all ? account.days : active;
  const hasOther = account.totals.otherPiastres !== 0;
  const csvHref = `/api/finance/rider-offices/${account.office.id}/account.csv?month=${account.month}&lang=${locale}`;
  const cells = (d: Omit<OfficeAccountDay, 'day' | 'balancePiastres'>) => (
    <>
      <td className={tdEnd}>{d.deliveries}</td>
      <td className={tdEnd}>
        <Move piastres={d.commissionPiastres} />
      </td>
      <td className={tdEnd}>
        <Move piastres={d.shortagesPiastres} down />
      </td>
      <td className={tdEnd}>
        <Move piastres={d.billedPiastres} />
      </td>
      <td className={tdEnd}>
        <Move piastres={d.paymentsPiastres} down />
      </td>
      {hasOther && (
        <td className={tdEnd}>
          <Move piastres={d.otherPiastres} />
        </td>
      )}
    </>
  );
  const facts: {
    key: 'commission' | 'shortages' | 'billed' | 'payments' | 'other';
    pick: (d: OfficeAccountDay) => number;
    down?: boolean;
  }[] = [
    { key: 'commission', pick: (d) => d.commissionPiastres },
    { key: 'shortages', pick: (d) => d.shortagesPiastres, down: true },
    { key: 'billed', pick: (d) => d.billedPiastres },
    { key: 'payments', pick: (d) => d.paymentsPiastres, down: true },
    { key: 'other', pick: (d) => d.otherPiastres },
  ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3">{t('title')}</h2>
          <p className="text-caption text-text-muted">{t('hint')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-caption">
            {t('month')}
            <input
              type="month"
              value={account.month}
              max={thisMonth}
              onChange={(e) =>
                e.target.value && router.push(`?month=${e.target.value}`, { scroll: false })
              }
              dir="ltr"
              className={`${field} mt-1 block w-44`}
            />
          </label>
          <a href={csvHref} className={`${secondary} content-center`}>
            {t('csv')}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('opening')}>
          <Balance owed={account.openingPiastres} />
        </Stat>
        <Stat label={t('commission')}>
          <Amount piastres={account.totals.commissionPiastres} />
        </Stat>
        <Stat label={t('deliveries')}>{account.totals.deliveries}</Stat>
        <Stat label={account.month === thisMonth ? t('closingToday') : t('closing')}>
          <Balance owed={account.closingPiastres} />
        </Stat>
      </div>

      {account.days.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('notStarted')}</p>
      ) : (
        <>
          {active.length < account.days.length && (
            <label className="flex items-center gap-2 text-body-sm">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              {t('showQuietDays')}
            </label>
          )}
          {shown.length === 0 && (
            <p className="text-body-sm text-text-muted">{t('nothingThisMonth')}</p>
          )}
          {/* Phones: one card per day */}
          <ul className="space-y-2 md:hidden">
            {shown.map((d) => (
              <li key={d.day} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="ltr-iso font-bold">{d.day}</span>
                  <Balance owed={d.balancePiastres} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm">
                  {d.deliveries > 0 && (
                    <>
                      <dt className="text-text-muted">{t('deliveries')}</dt>
                      <dd className="text-end">{d.deliveries}</dd>
                    </>
                  )}
                  {facts
                    .filter((f) => f.pick(d) !== 0)
                    .map((f) => (
                      <div key={f.key} className="contents">
                        <dt className="text-text-muted">{t(f.key)}</dt>
                        <dd className="text-end">
                          <Move piastres={f.pick(d)} down={f.down} />
                        </dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table
              head={
                <>
                  <th className={th}>{t('day')}</th>
                  <th className={thEnd}>{t('deliveries')}</th>
                  <th className={thEnd}>{t('commission')}</th>
                  <th className={thEnd}>{t('shortages')}</th>
                  <th className={thEnd}>{t('billed')}</th>
                  <th className={thEnd}>{t('payments')}</th>
                  {hasOther && <th className={thEnd}>{t('other')}</th>}
                  <th className={thEnd}>{t('balance')}</th>
                </>
              }
            >
              <tr className="border-t border-line text-text-muted">
                <td className={td} colSpan={hasOther ? 7 : 6}>
                  {t('opening')}
                </td>
                <td className={tdEnd}>
                  <Balance owed={account.openingPiastres} />
                </td>
              </tr>
              {shown.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className={`${td} ltr-iso`}>{d.day}</td>
                  {cells(d)}
                  <td className={tdEnd}>
                    <Balance owed={d.balancePiastres} />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line font-bold">
                <td className={td}>{t('total')}</td>
                {cells(account.totals)}
                <td className={tdEnd}>
                  <Balance owed={account.closingPiastres} />
                </td>
              </tr>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
