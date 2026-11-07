'use client';

import {
  addDays,
  cairoDay,
  entryNumber,
  parseStatementAmount,
  parseStatementDate,
  statementNumber,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import type {
  BankReconciliation,
  BankStatementRow,
  BookAccount,
  BudgetReport,
  CashFlowReport,
  CashForecast,
  StoreOption,
  VatReport,
  YearStatus,
} from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// Bank reconciliation, VAT per month, budgets, cash flow with a four week forecast, and
// the year end with the exports for the accountant and the auditor.

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

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

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-label uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-h3">{children}</p>
      {hint && <p className="text-caption text-text-muted">{hint}</p>}
    </div>
  );
}

/** Money going out shown as minus, without a "-0.00" for nothing. */
const minus = (piastres: number) => (piastres ? -piastres : 0);

const nameOf = (locale: string, a: { nameEn: string | null; nameAr: string | null }) =>
  (locale === 'ar' ? a.nameAr : a.nameEn) ?? a.nameEn ?? '';

// ─── bank ────────────────────────────────────────────────────────────────────

type Mapping = {
  header: number;
  date: number;
  description: number;
  reference: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
};

/** Guesses the header row and columns from the words banks use (English and Arabic). */
function guess(rows: string[][], forced?: number): Mapping {
  const header =
    forced ??
    Math.max(
      0,
      rows.findIndex((r) => r.some((c) => /date|تاريخ/i.test(c))),
    );
  const cols = rows[header] ?? [];
  const find = (re: RegExp) => cols.findIndex((c) => re.test(c));
  return {
    header,
    date:
      find(/value date|تاريخ القيمة/i) >= 0
        ? find(/value date|تاريخ القيمة/i)
        : find(/date|تاريخ/i),
    description: find(/desc|details|narrat|particular|بيان|وصف/i),
    reference: find(/ref|cheque|مرجع|رقم/i),
    amount: find(/^amount$|^المبلغ$/i),
    debit: find(/debit|withdraw|مدين|سحب/i),
    credit: find(/credit|deposit|دائن|إيداع/i),
    balance: find(/balance|رصيد/i),
  };
}

function StatementUpload({ banks }: { banks: BookAccount[] }) {
  const t = useTranslations('finance.period');
  const locale = useLocale();
  const action = useFinanceAction();
  const [accountId, setAccountId] = useState(banks[0]?.id ?? '');
  const [file, setFile] = useState<string>('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [error, setError] = useState('');

  const lines = useMemo(() => {
    if (!rows || !map) return [];
    const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '') : '');
    return rows.slice(map.header + 1).flatMap((r) => {
      const day = parseStatementDate(cell(r, map.date));
      let amount: number | null = null;
      if (map.amount >= 0) amount = parseStatementAmount(cell(r, map.amount));
      else {
        const out = parseStatementAmount(cell(r, map.debit));
        const inn = parseStatementAmount(cell(r, map.credit));
        amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0) || null;
      }
      if (!day || !amount) return [];
      const balance = map.balance >= 0 ? parseStatementAmount(cell(r, map.balance)) : null;
      const description = cell(r, map.description) || cell(r, map.reference) || '-';
      return [
        {
          day,
          description: description.slice(0, 300),
          reference: cell(r, map.reference).slice(0, 100) || undefined,
          amountPiastres: amount,
          ...(balance !== null ? { balancePiastres: balance } : {}),
        },
      ];
    });
  }, [rows, map]);

  async function read(f: File) {
    setError('');
    setRows(null);
    setFile(f.name);
    const res = await fetch('/api/finance/bank-statements/read', {
      method: 'POST',
      headers: { 'content-type': f.type || 'application/octet-stream' },
      body: f,
    });
    const data = (await res.json().catch(() => ({}))) as { rows?: string[][]; error?: string };
    if (!res.ok || !data.rows) {
      setError(t(`fileErrors.${data.error ?? 'generic'}`));
      return;
    }
    setRows(data.rows);
    setMap(guess(data.rows));
  }

  const headers = rows && map ? (rows[map.header] ?? []) : [];
  const select = (k: keyof Mapping, optional: boolean) => (
    <label className="block text-caption">
      {t(`columns.${k}`)}
      <select
        value={map![k]}
        onChange={(e) => setMap({ ...map!, [k]: Number(e.target.value) })}
        className={`${field} mt-1`}
      >
        {optional && <option value={-1}>{t('none')}</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || t('columnN', { n: i + 1 })}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('upload')}</h2>
      <p className="text-caption text-text-muted">{t('uploadHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-caption">
          {t('bank')}
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={`${field} mt-1`}
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} {nameOf(locale, b)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('file')}
          <input
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
            className="mt-1 block w-full text-body-sm"
          />
        </label>
      </div>
      {error && <p className="text-body-sm text-danger">{error}</p>}
      {rows && map && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block text-caption">
              {t('headerRow')}
              <select
                value={map.header}
                onChange={(e) => setMap(guess(rows, Number(e.target.value)))}
                className={`${field} mt-1`}
              >
                {rows.slice(0, 30).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}: {r.filter(Boolean).slice(0, 3).join(' · ').slice(0, 40)}
                  </option>
                ))}
              </select>
            </label>
            {select('date', false)}
            {select('description', true)}
            {select('reference', true)}
            {select('amount', true)}
            {map.amount < 0 && select('debit', true)}
            {map.amount < 0 && select('credit', true)}
            {select('balance', true)}
          </div>
          <p className="text-body-sm">{t('preview', { count: lines.length, file })}</p>
          {lines.length > 0 && (
            <Table
              head={
                <>
                  <th className={th}>{t('columns.date')}</th>
                  <th className={th}>{t('columns.description')}</th>
                  <th className={`${th} text-end`}>{t('amount')}</th>
                  <th className={`${th} text-end`}>{t('columns.balance')}</th>
                </>
              }
            >
              {lines.slice(0, 5).map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className={`${td} ltr-iso`}>{l.day}</td>
                  <td className={td}>{l.description}</td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={l.amountPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    {l.balancePiastres !== undefined && <Amount piastres={l.balancePiastres} />}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <button
            type="button"
            className={primary}
            disabled={action.busy || lines.length === 0 || !accountId}
            onClick={async () => {
              const ok = await action.send<{
                number: string;
                imported: number;
                skipped: number;
                matched: number;
              }>('POST', '/finance/bank-statements', { accountId, fileName: file, lines }, (d) =>
                t('imported', d),
              );
              if (ok) setRows(null);
            }}
          >
            {t('import')}
          </button>
        </>
      )}
      <ActionMessage message={action.message} />
    </section>
  );
}

function BankOnlyRow({
  line,
  candidates,
}: {
  line: BankReconciliation['bankOnly'][number];
  candidates: BankReconciliation['booksOnly'];
}) {
  const t = useTranslations('finance.period');
  const action = useFinanceAction();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const same = candidates.filter((c) => c.amountPiastres === line.amountPiastres);
  return (
    <>
      <tr className="border-t border-line">
        <td className={`${td} ltr-iso`}>{line.day}</td>
        <td className={td}>
          {line.description}
          <span className="block text-caption text-text-muted">
            {statementNumber(line.statement)} · {line.lineNo}
            {line.reference ? ` · ${line.reference}` : ''}
          </span>
        </td>
        <td className={`${td} text-end`}>
          <Amount piastres={line.amountPiastres} strong />
        </td>
        <td className={`${td} text-end`}>
          <button type="button" className={secondary} onClick={() => setOpen(!open)}>
            {open ? t('close') : t('resolve')}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-raised">
          <td colSpan={4} className="space-y-3 px-3 py-3">
            {same.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption">{t('matchWith')}</span>
                {same.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={secondary}
                    disabled={action.busy}
                    onClick={() =>
                      void action.send('POST', `/finance/bank-lines/${line.id}/match`, {
                        ledgerLineId: c.id,
                      })
                    }
                  >
                    {entryNumber(c.entryNumber)} · {cairoDay(new Date(c.at))}
                  </button>
                ))}
              </div>
            )}
            {line.amountPiastres < 0 && (
              <button
                type="button"
                className={secondary}
                disabled={action.busy}
                onClick={() =>
                  void action.send('POST', `/finance/bank-lines/${line.id}/bank-charge`, {})
                }
              >
                {t('bookCharge')}
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('ignoreNote')}
                aria-label={t('ignoreNote')}
                className={`${field} max-w-sm`}
              />
              <button
                type="button"
                className={secondary}
                disabled={action.busy || note.trim().length < 5}
                onClick={() =>
                  void action.send('POST', `/finance/bank-lines/${line.id}/ignore`, { note })
                }
              >
                {t('ignore')}
              </button>
            </div>
            <p className="text-caption text-text-muted">{t('resolveHint')}</p>
            <ActionMessage message={action.message} />
          </td>
        </tr>
      )}
    </>
  );
}

export function BankReconcile({
  banks,
  rec,
  statements,
}: {
  banks: BookAccount[];
  rec: BankReconciliation | null;
  statements: BankStatementRow[];
}) {
  const t = useTranslations('finance.period');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const router = useRouter();
  return (
    <div className="mt-4 space-y-8">
      {banks.length > 1 && rec && (
        <nav className="flex flex-wrap gap-2">
          {banks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`?account=${b.id}`)}
              className={`rounded-md border px-3 py-1 text-body-sm ${b.id === rec.account.id ? 'border-primary font-bold' : 'border-line'}`}
            >
              {b.code} {nameOf(locale, b)}
            </button>
          ))}
        </nav>
      )}
      {rec && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t('bookBalance')} hint={t('onDay', { day: rec.day })}>
              <Amount piastres={rec.bookBalancePiastres} />
            </Stat>
            <Stat
              label={t('bankBalance')}
              hint={rec.bankBalanceDay ? t('onDay', { day: rec.bankBalanceDay }) : t('noStatement')}
            >
              {rec.bankBalancePiastres === null ? (
                '-'
              ) : (
                <Amount piastres={rec.bankBalancePiastres} />
              )}
            </Stat>
            <Stat
              label={t('difference')}
              hint={t('matchedCount', { matched: rec.matched, ignored: rec.ignored })}
            >
              {rec.differencePiastres === null ? (
                '-'
              ) : rec.differencePiastres === 0 ? (
                <span className="text-status-delivered">{t('balanced')}</span>
              ) : (
                <span className="text-danger">
                  <Amount piastres={rec.differencePiastres} />
                </span>
              )}
            </Stat>
          </div>

          <section className="space-y-2">
            <h2 className="text-h3">{t('bankOnly', { count: rec.bankOnly.length })}</h2>
            <p className="text-caption text-text-muted">{t('bankOnlyHint')}</p>
            {rec.bankOnly.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('nothingLeft')}</p>
            ) : (
              <Table
                head={
                  <>
                    <th className={th}>{t('columns.date')}</th>
                    <th className={th}>{t('columns.description')}</th>
                    <th className={`${th} text-end`}>{t('amount')}</th>
                    <th className={th} />
                  </>
                }
              >
                {rec.bankOnly.map((l) => (
                  <BankOnlyRow key={l.id} line={l} candidates={rec.booksOnly} />
                ))}
              </Table>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-h3">{t('booksOnly', { count: rec.booksOnly.length })}</h2>
            <p className="text-caption text-text-muted">
              {rec.checkedSince
                ? t('booksOnlyHint', { since: rec.checkedSince })
                : t('noStatement')}
            </p>
            {rec.booksOnly.length > 0 && (
              <Table
                head={
                  <>
                    <th className={th}>{t('columns.date')}</th>
                    <th className={th}>{t('entry')}</th>
                    <th className={`${th} text-end`}>{t('amount')}</th>
                  </>
                }
              >
                {rec.booksOnly.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className={td}>{formatCairoDateTime(l.at, locale)}</td>
                    <td className={td}>
                      <span className="ltr-iso font-bold">{entryNumber(l.entryNumber)}</span>{' '}
                      {tf.has(`kinds.${l.kind}`) ? tf(`kinds.${l.kind}`) : l.kind}
                      {l.memo && (
                        <span className="block text-caption text-text-muted">{l.memo}</span>
                      )}
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={l.amountPiastres} strong />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </>
      )}

      <StatementUpload banks={banks} />

      {statements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-h3">{t('statements')}</h2>
          <Table
            head={
              <>
                <th className={th}>{t('statement')}</th>
                <th className={th}>{t('period')}</th>
                <th className={`${th} text-end`}>{t('lines')}</th>
                <th className={th}>{t('by')}</th>
              </>
            }
          >
            {statements.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className={td}>
                  <span className="ltr-iso font-bold">{statementNumber(s.number)}</span>
                  <span className="block text-caption text-text-muted">{s.fileName}</span>
                </td>
                <td className={`${td} ltr-iso`}>
                  {s.fromDay} → {s.toDay}
                </td>
                <td className={`${td} text-end`}>
                  {s.lines}
                  {s.skipped > 0 && (
                    <span className="block text-caption text-text-muted">
                      {t('skipped', { count: s.skipped })}
                    </span>
                  )}
                </td>
                <td className={td}>
                  {s.createdBy}
                  <span className="block text-caption text-text-muted">
                    {formatCairoDateTime(s.createdAt, locale)}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
}

// ─── VAT ─────────────────────────────────────────────────────────────────────

export function VatView({ report }: { report: VatReport }) {
  const t = useTranslations('finance.period');
  return (
    <div className="mt-4 space-y-4">
      <nav className="flex flex-wrap gap-2">
        {[report.year - 1, report.year + 1].map((y) => (
          <a
            key={y}
            href={`?tab=vat&year=${y}`}
            className="rounded-md border border-line px-3 py-1 text-body-sm"
          >
            {y}
          </a>
        ))}
      </nav>
      <Table
        head={
          <>
            <th className={th}>{t('month')}</th>
            <th className={`${th} text-end`}>{t('vatOutput')}</th>
            <th className={`${th} text-end`}>{t('vatInput')}</th>
            <th className={`${th} text-end`}>{t('vatDue')}</th>
            <th className={`${th} text-end`}>{t('vatPaid')}</th>
          </>
        }
      >
        {report.months.map((m) => (
          <tr key={m.month} className="border-t border-line">
            <td className={`${td} ltr-iso`}>{m.month}</td>
            <td className={`${td} text-end`}>
              <Amount piastres={m.outputPiastres} />
            </td>
            <td className={`${td} text-end`}>
              <Amount piastres={m.inputPiastres} />
            </td>
            <td className={`${td} text-end`}>
              <Amount piastres={m.duePiastres} strong />
            </td>
            <td className={`${td} text-end`}>
              <Amount piastres={m.paidPiastres} />
            </td>
          </tr>
        ))}
        <tr className="border-t border-line font-bold">
          <td className={td}>{t('total')}</td>
          <td className={`${td} text-end`}>
            <Amount piastres={report.total.outputPiastres} />
          </td>
          <td className={`${td} text-end`}>
            <Amount piastres={report.total.inputPiastres} />
          </td>
          <td className={`${td} text-end`}>
            <Amount piastres={report.total.duePiastres} strong />
          </td>
          <td className={`${td} text-end`}>
            <Amount piastres={report.total.paidPiastres} />
          </td>
        </tr>
      </Table>
      <p className="text-caption text-text-muted">{t('vatHint')}</p>
    </div>
  );
}

// ─── budgets ─────────────────────────────────────────────────────────────────

function BudgetCell({
  row,
  month,
  storeId,
}: {
  row: BudgetReport['rows'][number];
  month: string;
  storeId: string;
}) {
  const t = useTranslations('finance.period');
  const action = useFinanceAction();
  const [text, setText] = useState(row.budgetPiastres ? (row.budgetPiastres / 100).toFixed(2) : '');
  const value = text.trim() === '' ? 0 : parseEgp(text);
  return (
    <span className="flex items-center justify-end gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        aria-label={t('budget')}
        placeholder="0.00"
        className={`${field} w-28 text-end`}
      />
      <button
        type="button"
        className={secondary}
        disabled={action.busy || value === null || value === row.budgetPiastres}
        onClick={() =>
          void action.send('PUT', '/finance/budgets', {
            month,
            accountId: row.accountId,
            darkStoreId: storeId || undefined,
            amountPiastres: value,
          })
        }
      >
        {t('save')}
      </button>
      {action.message?.error && <ActionMessage message={action.message} />}
    </span>
  );
}

export function Budgets({ report, stores }: { report: BudgetReport; stores: StoreOption[] }) {
  const t = useTranslations('finance.period');
  const locale = useLocale();
  const router = useRouter();
  const storeId = report.darkStoreId ?? '';
  const go = (month: string, store: string) =>
    router.push(`?${new URLSearchParams({ month, ...(store ? { storeId: store } : {}) })}`);
  const section = (category: 'revenue' | 'expense') => {
    const rows = report.rows.filter((r) => r.category === category);
    return (
      <section className="space-y-2">
        <h2 className="text-h3">{category === 'revenue' ? t('income') : t('costs')}</h2>
        <Table
          head={
            <>
              <th className={th}>{t('account')}</th>
              <th className={`${th} text-end`}>{t('budget')}</th>
              <th className={`${th} text-end`}>{t('actual')}</th>
              <th className={`${th} text-end`}>{t('variance')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.accountId} className="border-t border-line">
              <td className={td}>
                <span className="ltr-iso text-text-muted">{r.code}</span>{' '}
                {locale === 'ar' ? r.nameAr : r.nameEn}
              </td>
              <td className={td}>
                <BudgetCell
                  key={`${report.month}${storeId}`}
                  row={r}
                  month={report.month}
                  storeId={storeId}
                />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={r.actualPiastres} />
              </td>
              <td
                className={`${td} text-end ${r.budgetPiastres && r.variancePiastres < 0 ? 'text-danger' : r.budgetPiastres && r.variancePiastres > 0 ? 'text-status-delivered' : ''}`}
              >
                {r.budgetPiastres ? <Amount piastres={r.variancePiastres} strong /> : '-'}
              </td>
            </tr>
          ))}
        </Table>
      </section>
    );
  };
  return (
    <div className="mt-4 space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption">
          {t('month')}
          <input
            type="month"
            value={report.month}
            onChange={(e) => e.target.value && go(e.target.value, storeId)}
            dir="ltr"
            className={`${field} mt-1 block w-44`}
          />
        </label>
        <label className="text-caption">
          {t('store')}
          <select
            value={storeId}
            onChange={(e) => go(report.month, e.target.value)}
            className={`${field} mt-1 block w-56`}
          >
            <option value="">{t('wholeCompany')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {locale === 'ar' ? s.nameAr : s.nameEn}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label={t('income')}
          hint={t('ofBudget', { amount: formatEgp(report.income.budgetPiastres) })}
        >
          <Amount piastres={report.income.actualPiastres} />
        </Stat>
        <Stat
          label={t('costs')}
          hint={t('ofBudget', { amount: formatEgp(report.costs.budgetPiastres) })}
        >
          <Amount piastres={report.costs.actualPiastres} />
        </Stat>
      </div>
      {!storeId && <p className="text-caption text-text-muted">{t('budgetCompanyHint')}</p>}
      {section('revenue')}
      {section('expense')}
    </div>
  );
}

// ─── cash flow ───────────────────────────────────────────────────────────────

export function CashFlowView({
  flow,
  forecast,
  from,
  to,
}: {
  flow: CashFlowReport;
  forecast: CashForecast;
  from: string;
  to: string;
}) {
  const t = useTranslations('finance.period');
  const tf = useTranslations('finance');
  const [range, setRange] = useState({ from, to });
  return (
    <div className="mt-4 space-y-8">
      <section className="space-y-3">
        <h2 className="text-h3">{t('forecast')}</h2>
        <p className="text-caption text-text-muted">
          {t('forecastHint', { amount: formatEgp(forecast.weeklyTradingPiastres) })}
        </p>
        <Table
          head={
            <>
              <th className={th}>{t('week')}</th>
              <th className={`${th} text-end`}>{t('opening')}</th>
              <th className={`${th} text-end`}>{t('trading')}</th>
              <th className={`${th} text-end`}>{t('billsDue')}</th>
              <th className={`${th} text-end`}>{t('recurring')}</th>
              <th className={`${th} text-end`}>{t('salaries')}</th>
              <th className={`${th} text-end`}>{t('taxes')}</th>
              <th className={`${th} text-end`}>{t('closing')}</th>
            </>
          }
        >
          {forecast.weeks.map((w) => (
            <tr key={w.from} className="border-t border-line">
              <td className={`${td} ltr-iso`}>
                {w.from} → {w.to}
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={w.openingPiastres} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={w.tradingPiastres} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={minus(w.billsPiastres)} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={minus(w.recurringPiastres)} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={minus(w.salariesPiastres)} />
              </td>
              <td className={`${td} text-end`}>
                <Amount piastres={minus(w.taxesPiastres)} />
              </td>
              <td className={`${td} text-end ${w.closingPiastres < 0 ? 'text-danger' : ''}`}>
                <Amount piastres={w.closingPiastres} strong />
              </td>
            </tr>
          ))}
        </Table>
        {forecast.weeks.some((w) => w.closingPiastres < 0) && (
          <p className="text-body-sm font-bold text-danger">{t('forecastShort')}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">{t('cashFlow')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption">
            {tf('from')}
            <DateInput
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </label>
          <label className="text-caption">
            {tf('to')}
            <DateInput
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </label>
          <a
            href={`?${new URLSearchParams(range)}`}
            className={`${secondary} inline-flex items-center`}
          >
            {tf('apply')}
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label={t('opening')}>
            <Amount piastres={flow.openingPiastres} />
          </Stat>
          <Stat label={t('closing')}>
            <Amount piastres={flow.closingPiastres} />
          </Stat>
        </div>
        {flow.sections.map((s) => (
          <div key={s.section} className="space-y-1">
            <h3 className="text-body font-bold">
              {t(`sections.${s.section}`)} · <Amount piastres={s.netPiastres} strong />
            </h3>
            {s.rows.length > 0 && (
              <Table
                head={
                  <>
                    <th className={th}>{t('kind')}</th>
                    <th className={`${th} text-end`}>{t('in')}</th>
                    <th className={`${th} text-end`}>{t('out')}</th>
                  </>
                }
              >
                {s.rows.map((r) => (
                  <tr key={r.kind} className="border-t border-line">
                    <td className={td}>
                      {tf.has(`kinds.${r.kind}`) ? tf(`kinds.${r.kind}`) : r.kind}
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={r.inPiastres} />
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={minus(r.outPiastres)} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        ))}
        <p className="text-caption text-text-muted">{t('cashFlowHint')}</p>
      </section>
    </div>
  );
}

// ─── year end and exports ────────────────────────────────────────────────────

function CloseYearButton({ year }: { year: number }) {
  const t = useTranslations('finance.period');
  const action = useFinanceAction();
  const [sure, setSure] = useState(false);
  return (
    <span className="flex flex-col items-end gap-1">
      {sure ? (
        <span className="flex gap-2">
          <button
            type="button"
            className={primary}
            disabled={action.busy}
            onClick={() =>
              void action.send<{ entryNumber: string | null; profitPiastres: number }>(
                'POST',
                '/finance/year-close',
                { year },
                (d) =>
                  t('yearClosed', {
                    number: d.entryNumber ?? '',
                    amount: formatEgp(d.profitPiastres),
                  }),
              )
            }
          >
            {t('confirmClose', { year })}
          </button>
          <button type="button" className={secondary} onClick={() => setSure(false)}>
            {t('cancel')}
          </button>
        </span>
      ) : (
        <button type="button" className={secondary} onClick={() => setSure(true)}>
          {t('closeYear')}
        </button>
      )}
      <ActionMessage message={action.message} />
    </span>
  );
}

export function YearEnd({ years }: { years: YearStatus[] }) {
  const t = useTranslations('finance.period');
  const today = cairoDay(new Date());
  const [range, setRange] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const query = new URLSearchParams(range).toString();
  return (
    <div className="mt-4 space-y-8">
      <section className="space-y-2">
        <h2 className="text-h3">{t('years')}</h2>
        <p className="text-caption text-text-muted">{t('yearsHint')}</p>
        {years.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noYears')}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('year')}</th>
                <th className={th}>{t('state')}</th>
                <th className={th} />
              </>
            }
          >
            {years.map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className={`${td} ltr-iso font-bold`}>{y.year}</td>
                <td className={td}>
                  {y.closed
                    ? t('closedWith', { number: entryNumber(y.entryNumber ?? 0) })
                    : y.over
                      ? t('waitingClose')
                      : t('running')}
                </td>
                <td className={`${td} text-end`}>
                  {y.over && !y.closed && <CloseYearButton year={y.year} />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('exports')}</h2>
        <p className="text-caption text-text-muted">{t('exportsHint')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption">
            {t('fromDay')}
            <DateInput
              value={range.from}
              max={today}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </label>
          <label className="text-caption">
            {t('toDay')}
            <DateInput
              value={range.to}
              max={today}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={secondary}
            onClick={() =>
              setRange({
                from: `${Number(today.slice(0, 4)) - 1}-01-01`,
                to: `${Number(today.slice(0, 4)) - 1}-12-31`,
              })
            }
          >
            {t('lastYear')}
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() =>
              setRange({
                from: `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`,
                to: addDays(`${today.slice(0, 7)}-01`, -1),
              })
            }
          >
            {t('lastMonth')}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/api/finance/export/journal.csv?${query}`}
            className={`${primary} inline-flex items-center`}
          >
            {t('downloadJournal')}
          </a>
          <a
            href={`/api/finance/export/audit-pack.zip?${query}`}
            className={`${secondary} inline-flex items-center`}
          >
            {t('downloadPack')}
          </a>
        </div>
      </section>
    </div>
  );
}
