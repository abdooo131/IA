'use client';

import { AGING_BANDS, type AgingBuckets, exportCsv, exportXlsx } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { download } from '@/components/odoo/ListView';
import type { PayablesAging, ReceivablesAging } from '@/lib/aging-types';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// The aging reports (who owes us, what we owe suppliers, by age): filters kept in the address
// (day, search, store), a row per party with its amount in each age band, totals, exports
// (PDF in English or Arabic from the API, CSV and Excel here) and, for merchants who owe us,
// the payment reminders sent and Send reminder now.

const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const egp = (p: number) => Number((p / 100).toFixed(2));

export function AgingFilters({
  kind,
  day,
  q,
  store,
  stores,
}: {
  kind: 'receivables' | 'payables';
  day: string;
  q: string;
  store?: string;
  stores?: { id: string; label: string }[];
}) {
  const t = useTranslations('finance.aging');
  return (
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
      <label className="text-caption">
        {t('asOf')}
        <DateInput name="day" defaultValue={day} className={`${field} mt-1 block`} />
      </label>
      <label className="text-caption">
        {t('search')}
        <input
          name="q"
          defaultValue={q}
          placeholder={t(kind === 'receivables' ? 'searchMerchants' : 'searchSuppliers')}
          className={`${field} mt-1 block w-56`}
        />
      </label>
      {stores && (
        <label className="text-caption">
          {t('store')}
          <select name="store" defaultValue={store ?? ''} className={`${field} mt-1 block`}>
            <option value="">{t('allStores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed"
      >
        {t('apply')}
      </button>
    </form>
  );
}

function ExportMenu({
  pdf,
  file,
  table,
}: {
  pdf: (lang: 'en' | 'ar') => string;
  file: string;
  table: () => { header: string[]; rows: (string | number | null)[][] };
}) {
  const t = useTranslations('finance.aging');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the menu (and gives the focus back to its button).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const item =
    'flex min-h-10 w-full items-center rounded-md px-2 text-start text-body-sm hover:bg-surface-raised';
  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-semibold hover:bg-surface-raised"
      >
        {t('export')}
      </button>
      {open && (
        <ul className="absolute end-0 z-40 mt-1 w-56 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <li>
            <a href={pdf('en')} className={item} onClick={() => setOpen(false)}>
              {t('pdfEn')}
            </a>
          </li>
          <li>
            <a href={pdf('ar')} className={item} onClick={() => setOpen(false)}>
              {t('pdfAr')}
            </a>
          </li>
          <li>
            <button
              type="button"
              className={item}
              onClick={() => {
                const x = table();
                download(
                  `${file}.csv`,
                  new Blob([exportCsv(x.header, x.rows)], { type: 'text/csv;charset=utf-8' }),
                );
                setOpen(false);
              }}
            >
              {t('csv')}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={item}
              onClick={() => {
                const x = table();
                download(
                  `${file}.xlsx`,
                  new Blob(
                    [
                      exportXlsx(x.header, x.rows, {
                        sheetName: file,
                        rtl: locale === 'ar',
                      }) as BlobPart,
                    ],
                    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                  ),
                );
                setOpen(false);
              }}
            >
              {t('xlsx')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function BandHeads() {
  const t = useTranslations('finance.aging');
  return (
    <>
      {AGING_BANDS.map((b) => (
        <th key={b} className={`${th} text-end`}>
          {t(`bands.${b}`)}
        </th>
      ))}
    </>
  );
}

function BandCells({ buckets, strong = false }: { buckets: AgingBuckets; strong?: boolean }) {
  return (
    <>
      {AGING_BANDS.map((b) => (
        <td key={b} className={`${td} text-end`}>
          {buckets[b] ? <Amount piastres={buckets[b]} strong={strong} /> : ''}
        </td>
      ))}
    </>
  );
}

function SendReminder({ merchantId }: { merchantId: string }) {
  const t = useTranslations('finance.aging');
  const action = useFinanceAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="h-9 whitespace-nowrap rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50"
        disabled={action.busy}
        onClick={() =>
          void action.send<{ number: number }>(
            'POST',
            `/finance/receivables/${merchantId}/remind`,
            { idempotencyKey: newActionKey() },
            (d) => t('reminderSent', { number: d.number }),
          )
        }
      >
        {t('sendReminder')}
      </button>
      <ActionMessage message={action.message} />
    </span>
  );
}

export function ReceivablesAgingView({
  report,
  query,
  canRemind,
  rules,
}: {
  report: ReceivablesAging;
  /** The page's filters as a query string, for the PDF links */
  query: string;
  canRemind: boolean;
  rules: { enabled: boolean; firstDays: number; everyDays: number; max: number };
}) {
  const t = useTranslations('finance.aging');
  const locale = useLocale();
  const band = (b: (typeof AGING_BANDS)[number]) => t(`bands.${b}`);
  const table = () => ({
    header: [
      t('section'),
      t('name'),
      ...AGING_BANDS.map(band),
      t('total'),
      t('oldest'),
      t('remindersSent'),
    ],
    rows: [
      ...report.merchants.map((m) => [
        t('merchantsTitle'),
        m.name,
        ...AGING_BANDS.map((b) => egp(m.buckets[b])),
        egp(m.balancePiastres),
        m.oldestDay,
        m.reminders.count,
      ]),
      ...report.cheques.map((c) => [
        t('chequesTitle'),
        `${c.label} ${c.partyName}`,
        ...AGING_BANDS.map((b) => (b === c.band ? egp(c.amountPiastres) : 0)),
        egp(c.amountPiastres),
        c.dueDay,
        null,
      ]),
      [
        t('grandTotal'),
        '',
        ...AGING_BANDS.map((b) => egp(report.total.buckets[b])),
        egp(report.total.total),
        null,
        null,
      ],
    ],
  });
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm">
          {t('owedTotal')} <Amount piastres={report.total.total} strong />
        </p>
        <ExportMenu
          pdf={(lang) => `/api/finance/aging/receivables/export.pdf?${query}&lang=${lang}`}
          file={`${t('files.receivables')}-${report.asOf}`}
          table={table}
        />
      </div>
      <p className="mt-2 max-w-3xl text-caption text-text-muted">
        {rules.enabled
          ? t('remindersRule', {
              first: rules.firstDays,
              every: rules.everyDays,
              max: rules.max,
            })
          : t('remindersOff')}
      </p>

      <h2 className="mt-6 text-h3">{t('merchantsTitle')}</h2>
      {report.merchants.length === 0 ? (
        <p className="mt-2 text-body-sm text-text-muted">{t('nobody')}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('merchant')}</th>
                <BandHeads />
                <th className={`${th} text-end`}>{t('total')}</th>
                <th className={th}>{t('reminders')}</th>
                {canRemind && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {report.merchants.map((m) => (
                <tr key={m.merchantId} className="border-t border-line">
                  <td className={td}>
                    <a href={`/finance/merchants/${m.merchantId}`} className="font-bold underline">
                      {m.name}
                    </a>
                    {m.phone && (
                      <span className="block ltr-iso text-caption text-text-muted">{m.phone}</span>
                    )}
                    {m.oldestDay && (
                      <span className="block text-caption text-text-muted">
                        {t('oldestIs', {
                          day: isoToDayFirst(m.oldestDay),
                          days: m.oldestDays ?? 0,
                        })}
                      </span>
                    )}
                  </td>
                  <BandCells buckets={m.buckets} />
                  <td className={`${td} text-end`}>
                    <Amount piastres={m.balancePiastres} strong />
                  </td>
                  <td className={td}>
                    {m.reminders.count === 0
                      ? t('noReminders')
                      : t('remindersCount', {
                          count: m.reminders.count,
                          date: m.reminders.lastAt
                            ? formatCairoDateTime(m.reminders.lastAt, locale)
                            : '',
                        })}
                  </td>
                  {canRemind && (
                    <td className={`${td} text-end`}>
                      <SendReminder merchantId={m.merchantId} />
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-line bg-surface-raised">
                <td className={`${td} font-bold`}>{t('total')}</td>
                <BandCells buckets={report.merchantTotal.buckets} strong />
                <td className={`${td} text-end`}>
                  <Amount piastres={report.merchantTotal.total} strong />
                </td>
                <td className={td} />
                {canRemind && <td className={td} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {report.cheques.length > 0 && (
        <>
          <h2 className="mt-6 text-h3">{t('chequesTitle')}</h2>
          <p className="mt-1 text-caption text-text-muted">{t('chequesHint')}</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('cheque')}</th>
                  <th className={th}>{t('dueDay')}</th>
                  <BandHeads />
                </tr>
              </thead>
              <tbody>
                {report.cheques.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className={td}>
                      <a href={`/finance/cheques/${c.id}`} className="ltr-iso font-bold underline">
                        {c.label}
                      </a>
                      <span className="block text-caption text-text-muted">{c.partyName}</span>
                    </td>
                    <td className={td}>{isoToDayFirst(c.dueDay)}</td>
                    {AGING_BANDS.map((b) => (
                      <td key={b} className={`${td} text-end`}>
                        {b === c.band ? <Amount piastres={c.amountPiastres} /> : ''}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface-raised">
                  <td className={`${td} font-bold`} colSpan={2}>
                    {t('total')}
                  </td>
                  <BandCells buckets={report.chequeTotal.buckets} strong />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-body-sm">
            {t('grandTotal')}: <Amount piastres={report.total.total} strong />
          </p>
        </>
      )}
    </>
  );
}

export function PayablesAgingView({
  report,
  query,
  stores,
}: {
  report: PayablesAging;
  query: string;
  stores: Record<string, string>;
}) {
  const t = useTranslations('finance.aging');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const band = (b: (typeof AGING_BANDS)[number]) => t(`bands.${b}`);
  const table = () => ({
    header: [
      t('supplier'),
      t('bill'),
      t('reference'),
      t('billDay'),
      t('dueDay'),
      t('daysLate'),
      ...AGING_BANDS.map(band),
      t('total'),
    ],
    rows: [
      ...report.suppliers.flatMap((s) =>
        s.bills.map((b) => [
          s.name,
          b.label,
          b.reference,
          b.billDay,
          b.dueDay,
          Math.max(b.daysLate, 0),
          ...AGING_BANDS.map((k) => (k === b.band ? egp(b.leftPiastres) : 0)),
          egp(b.leftPiastres),
        ]),
      ),
      [
        t('total'),
        '',
        '',
        '',
        '',
        null,
        ...AGING_BANDS.map((k) => egp(report.total.buckets[k])),
        egp(report.total.total),
      ],
    ],
  });
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm">
          {t('oweTotal')} <Amount piastres={report.total.total} strong />
        </p>
        <ExportMenu
          pdf={(lang) => `/api/finance/aging/payables/export.pdf?${query}&lang=${lang}`}
          file={`${t('files.payables')}-${report.asOf}`}
          table={table}
        />
      </div>
      {report.suppliers.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">{t('noBills')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('supplier')}</th>
                <BandHeads />
                <th className={`${th} text-end`}>{t('total')}</th>
              </tr>
            </thead>
            <tbody>
              {report.suppliers.map((s) => (
                <Fragment key={s.supplierId}>
                  <tr className="border-t border-line">
                    <td className={td}>
                      <button
                        type="button"
                        aria-expanded={open.has(s.supplierId)}
                        onClick={() => toggle(s.supplierId)}
                        className="text-start font-bold underline"
                      >
                        {s.name}
                      </button>
                      <span className="block text-caption text-text-muted">
                        {t('billsCount', { count: s.bills.length })}
                      </span>
                    </td>
                    <BandCells buckets={s.buckets} />
                    <td className={`${td} text-end`}>
                      <Amount piastres={s.total} strong />
                    </td>
                  </tr>
                  {open.has(s.supplierId) &&
                    s.bills.map((b) => (
                      <tr key={b.id} className="border-t border-line bg-surface-raised">
                        <td className={`${td} ps-6`}>
                          <a href={`/finance/bills/${b.id}`} className="ltr-iso underline">
                            {b.label}
                          </a>
                          <span className="block text-caption text-text-muted">
                            {t('billLine', {
                              reference: b.reference,
                              due: isoToDayFirst(b.dueDay),
                              days: Math.max(b.daysLate, 0),
                            })}
                            {b.darkStoreId && stores[b.darkStoreId]
                              ? ` · ${stores[b.darkStoreId]}`
                              : ''}
                            {b.currency !== 'EGP' ? ` · ${b.currency}` : ''}
                          </span>
                        </td>
                        {AGING_BANDS.map((k) => (
                          <td key={k} className={`${td} text-end`}>
                            {k === b.band ? <Amount piastres={b.leftPiastres} /> : ''}
                          </td>
                        ))}
                        <td className={`${td} text-end`}>
                          <Amount piastres={b.leftPiastres} />
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              <tr className="border-t border-line bg-surface-raised">
                <td className={`${td} font-bold`}>{t('total')}</td>
                <BandCells buckets={report.total.buckets} strong />
                <td className={`${td} text-end`}>
                  <Amount piastres={report.total.total} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
