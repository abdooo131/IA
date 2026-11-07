'use client';

import { PETTY_CASH_STATUSES } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import type { PettyCashRow, PettyCategory } from '@/lib/cash-control-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const STATUS_TONE: Record<PettyCashRow['status'], string> = {
  posted: 'text-status-delivered',
  pending: 'text-status-needs-action',
  rejected: 'text-danger',
  cancelled: 'text-text-muted',
  reversed: 'text-text-muted',
};

function Row({ row, canReverse }: { row: PettyCashRow; canReverse: boolean }) {
  const t = useTranslations('cashControl.petty');
  const locale = useLocale();
  const action = useFinanceAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const category =
    locale === 'ar' ? row.category.nameAr || row.category.nameEn : row.category.nameEn;
  return (
    <li className="space-y-2 px-3 py-3 text-body-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span>
          <span className="ltr-iso me-2 font-bold">{row.label}</span>
          <span className={`font-semibold ${STATUS_TONE[row.status]}`}>
            {t(`statuses.${row.status}`)}
          </span>
          <span className="block">
            {localized(row.store, locale)} · <span className="ltr-iso">{row.category.code}</span>{' '}
            {category}
          </span>
          <span className="block text-text-muted">
            {row.note} · {row.by} ·{' '}
            <span className="ltr-iso">{formatCairoDateTime(row.createdAt, locale)}</span>
          </span>
          {row.status === 'rejected' && row.decisionNote && (
            <span className="block text-danger">{row.decisionNote}</span>
          )}
          {row.status === 'reversed' && (
            <span className="block text-text-muted">
              {t('reversedBy', { name: row.reversedBy ?? '', reason: row.reverseReason ?? '' })}
            </span>
          )}
        </span>
        <span className="text-end">
          <Amount piastres={row.amountPiastres} strong /> {t('egp')}
          <span className="mt-1 flex justify-end gap-3">
            <a
              href={`/api/photos/${row.photoId}`}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-link"
            >
              {t('receipt')}
            </a>
            {row.status === 'pending' && (
              <Link href="/finance/approvals" className="font-bold text-link">
                {t('toApprovals')}
              </Link>
            )}
            {row.status === 'posted' && canReverse && (
              <button
                type="button"
                className="font-bold text-link"
                onClick={() => setOpen((v) => !v)}
              >
                {t('reverse')}
              </button>
            )}
          </span>
        </span>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-caption">
            {t('reason')}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${field} mt-1 block w-full`}
            />
          </label>
          <button
            type="button"
            disabled={action.busy || reason.trim().length < 5}
            onClick={() =>
              void action.send('POST', `/finance/petty-cash/${row.id}/reverse`, { reason })
            }
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
          >
            {t('reverseConfirm')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

function Categories({
  categories,
  canPrepare,
}: {
  categories: PettyCategory[];
  canPrepare: boolean;
}) {
  const t = useTranslations('cashControl.petty');
  const locale = useLocale();
  const action = useFinanceAction();
  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('categories.title')}</h2>
      <p className="text-caption text-text-muted">{t('categories.intro')}</p>
      <ul className="mt-2 divide-y divide-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-body-sm">
            <span>
              <span className="ltr-iso me-2 text-text-muted">{c.code}</span>
              {localized(c, locale)}
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={c.petty}
                disabled={!canPrepare || action.busy}
                onChange={(e) =>
                  void action.send('POST', `/finance/petty-cash/categories/${c.id}`, {
                    petty: e.target.checked,
                  })
                }
              />
              {c.petty ? t('categories.on') : t('categories.off')}
            </label>
          </li>
        ))}
      </ul>
      <ActionMessage message={action.message} />
    </section>
  );
}

export function PettyCashDesk({
  rows,
  categories,
  stores,
  store,
  status,
  canPrepare,
  canReverse,
}: {
  rows: PettyCashRow[];
  categories: PettyCategory[];
  stores: { id: string; code: string; nameEn: string; nameAr: string }[];
  store: string;
  status: string;
  canPrepare: boolean;
  canReverse: boolean;
}) {
  const t = useTranslations('cashControl.petty');
  const locale = useLocale();
  const router = useRouter();
  const go = (next: { store?: string; status?: string }) => {
    const q = new URLSearchParams();
    const s = next.store ?? store;
    const st = next.status ?? status;
    if (s) q.set('store', s);
    if (st) q.set('status', st);
    router.push(`/finance/petty-cash${q.size ? `?${q}` : ''}`);
  };
  const total = rows
    .filter((r) => r.status === 'posted')
    .reduce((sum, r) => sum + r.amountPiastres, 0);
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-caption">
          {t('store')}
          <select
            value={store}
            onChange={(e) => go({ store: e.target.value })}
            className={`${field} mt-1 block`}
          >
            <option value="">{t('allStores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          {t('status')}
          <select
            value={status}
            onChange={(e) => go({ status: e.target.value })}
            className={`${field} mt-1 block`}
          >
            <option value="">{t('allStatuses')}</option>
            {PETTY_CASH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-body-sm">
          {t('postedTotal')}: <Amount piastres={total} strong /> {t('egp')}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('none')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((r) => (
            <Row key={r.id} row={r} canReverse={canReverse} />
          ))}
        </ul>
      )}
      <Categories categories={categories} canPrepare={canPrepare} />
    </>
  );
}
