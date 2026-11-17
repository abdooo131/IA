'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { candidatesFor, type NeedsOwnerRow, type OwnerCandidates } from '@/lib/hr-phase2';

/**
 * HR phase 2: what people who left looked after and nobody owns yet (their team, a department,
 * merchants, deals, companies). HR manage picks the new owner of each line.
 */
export function NeedsOwnerList({
  rows,
  candidates,
  canManage,
}: {
  rows: NeedsOwnerRow[];
  candidates: OwnerCandidates;
  canManage: boolean;
}) {
  const t = useTranslations('hr2');
  const locale = useLocale();
  const router = useRouter();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(row: NeedsOwnerRow) {
    const newOwnerId = chosen[row.id];
    if (!newOwnerId) return;
    setBusy(row.id);
    setError(null);
    const res = await apiSend('PUT', `/hr/reassignments/${row.id}`, { newOwnerId });
    setBusy(null);
    if (!res.ok)
      return setError(
        t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t('errors.generic'),
      );
    router.refresh();
  }

  return (
    <>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        {rows.map((r) => (
          <li
            key={r.id}
            className="grid min-w-0 gap-2 p-3 md:grid-cols-[1fr_1fr_auto] md:items-center"
          >
            <span className="min-w-0">
              <span className="block text-caption text-text-muted">{t(`kinds.${r.kind}`)}</span>
              <span className="block truncate font-bold">{r.label}</span>
              <span className="block text-caption text-text-muted">
                {t('needsOwner.leftBy')}{' '}
                <Link href={`/admin/hr/${r.leaver.id}`} className="text-link">
                  {locale === 'ar' && r.leaver.nameAr ? r.leaver.nameAr : r.leaver.nameEn}
                </Link>
                {r.leaver.lastDay && (
                  <>
                    {' · '}
                    <span className="ltr-iso">{isoToDayFirst(r.leaver.lastDay)}</span>
                  </>
                )}
              </span>
            </span>
            {canManage ? (
              <>
                <select
                  aria-label={t('leaving.newOwner')}
                  value={chosen[r.id] ?? ''}
                  onChange={(e) => setChosen({ ...chosen, [r.id]: e.target.value })}
                  className="h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-body-sm"
                >
                  <option value="">{t('leaving.newOwner')}</option>
                  {candidatesFor(r.kind, candidates, r.entityId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {locale === 'ar' ? c.labelAr : c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!chosen[r.id] || busy === r.id}
                  onClick={() => void save(r)}
                  className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {t('needsOwner.give')}
                </button>
              </>
            ) : (
              <span className="text-caption text-text-muted md:col-span-2">
                {t('needsOwner.manageOnly')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
