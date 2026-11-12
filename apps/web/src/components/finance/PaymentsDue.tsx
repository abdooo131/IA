import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { PaymentDueGroup, PaymentDueKind } from '@shiplynow/shared';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';

export interface PaymentDueRow {
  key: string;
  kind: PaymentDueKind;
  id: string;
  label: string;
  counterparty: string | null;
  amountPiastres: number | null;
  dueDay: string;
  href: string;
  darkStoreId: string | null;
  detail: string | null;
}
export interface PaymentsDueData {
  today: string;
  until: string;
  items: PaymentDueRow[];
  groups: { key: PaymentDueGroup; count: number; totalPiastres: number; items: PaymentDueRow[] }[];
}

const GROUP_TONE: Record<PaymentDueGroup, string> = {
  overdue: 'text-danger',
  week: 'text-text',
  month: 'text-text',
  later: 'text-text-muted',
};

/**
 * "Coming up and due": the groups (overdue, within 7 days, within 30 days, later) with their
 * totals and one row per payment linking to the screen that pays it. `limit` keeps the
 * dashboard card short (each group shows that many rows, then a link to the full page).
 */
export async function PaymentsDueGroups({
  data,
  limit,
}: {
  data: PaymentsDueData;
  limit?: number;
}) {
  const [t, tf] = await Promise.all([getTranslations('finance.due'), getTranslations('finance')]);
  const detail = (r: PaymentDueRow) =>
    r.detail ? (r.kind === 'tax' ? t(`taxes.${r.detail}`) : t(`details.${r.detail}`)) : null;
  const label = (r: PaymentDueRow) =>
    r.kind === 'salaries' || r.kind === 'tax' || r.kind === 'postal'
      ? t('forMonth', { month: r.label })
      : r.label;
  return (
    <div className={`grid grid-cols-1 gap-4 ${limit ? 'lg:grid-cols-3' : ''}`}>
      {data.groups.map((g) => {
        const rows = limit ? g.items.slice(0, limit) : g.items;
        return (
          <section
            key={g.key}
            aria-labelledby={`due-${g.key}`}
            className="min-w-0 rounded-md border border-line p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`due-${g.key}`} className={`text-body font-bold ${GROUP_TONE[g.key]}`}>
                {t(`groups.${g.key}`)}{' '}
                <span className="ltr-iso text-caption text-text-muted">({g.count})</span>
              </h3>
              <p className="ltr-iso text-body-sm font-bold">
                {formatEgp(g.totalPiastres)} {tf('egp')}
              </p>
            </div>
            {g.count === 0 ? (
              <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.key}>
                    <Link
                      href={r.href}
                      className="flex items-start justify-between gap-3 rounded-md px-1 py-2 hover:bg-surface-raised"
                    >
                      <span className="min-w-0 text-body-sm">
                        <span className="block truncate font-semibold">
                          {t(`kinds.${r.kind}`)} · <span className="ltr-iso">{label(r)}</span>
                        </span>
                        <span className="block truncate text-caption text-text-muted">
                          <span className="ltr-iso">
                            {r.dueDay === data.today ? t('today') : isoToDayFirst(r.dueDay)}
                          </span>
                          {r.counterparty ? ` · ${r.counterparty}` : ''}
                          {detail(r) ? ` · ${detail(r)}` : ''}
                        </span>
                      </span>
                      <span className="ltr-iso shrink-0 text-body-sm font-semibold">
                        {r.amountPiastres === null ? t('noAmount') : formatEgp(r.amountPiastres)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {limit && g.count > rows.length ? (
              <Link href="/finance/due" className="mt-1 block text-caption font-bold text-link">
                {t('more', { count: g.count - rows.length })}
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
