'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { PayoutCheckRow } from '@/lib/finance-types';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

/** The payout checks Accounting ticks before paying (accounting manage edits them). */
export function PayoutChecksEditor({
  checks,
  canManage,
}: {
  checks: PayoutCheckRow[];
  canManage: boolean;
}) {
  const t = useTranslations('finance.payoutChecks');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: '', labelEn: '', labelAr: '' });
  const [edits, setEdits] = useState<Record<string, Partial<PayoutCheckRow>>>({});
  const errorText = (code: string) =>
    t(t.has(`errors.${code}`) ? `errors.${code}` : 'errors.generic');

  async function send(method: 'POST' | 'PATCH', path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const r = await apiSend(method, path, body);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {checks.map((c) => {
          const e = { ...c, ...edits[c.id] };
          const changed = !!edits[c.id];
          return (
            <li key={c.id} className="space-y-2 px-4 py-3 text-body-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{locale === 'ar' ? c.labelAr : c.labelEn}</span>
                <span className="ltr-iso text-caption text-text-muted">
                  {c.code}
                  {c.system ? ` · ${t('system')}` : ''} · {c.active ? t('on') : t('off')}
                </span>
              </div>
              {canManage && (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]">
                  <input
                    aria-label={t('labelEn')}
                    value={e.labelEn}
                    dir="ltr"
                    onChange={(x) =>
                      setEdits((m) => ({ ...m, [c.id]: { ...m[c.id], labelEn: x.target.value } }))
                    }
                    className={field}
                  />
                  <input
                    aria-label={t('labelAr')}
                    value={e.labelAr}
                    dir="rtl"
                    onChange={(x) =>
                      setEdits((m) => ({ ...m, [c.id]: { ...m[c.id], labelAr: x.target.value } }))
                    }
                    className={field}
                  />
                  <input
                    aria-label={t('sort')}
                    type="number"
                    min={0}
                    max={999}
                    value={e.sort}
                    onChange={(x) =>
                      setEdits((m) => ({
                        ...m,
                        [c.id]: { ...m[c.id], sort: Number(x.target.value) || 0 },
                      }))
                    }
                    className={field}
                  />
                  <label className="flex items-center gap-2 text-caption">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={e.active}
                      disabled={c.system}
                      onChange={(x) =>
                        setEdits((m) => ({
                          ...m,
                          [c.id]: { ...m[c.id], active: x.target.checked },
                        }))
                      }
                    />
                    {t('active')}
                  </label>
                </div>
              )}
              {canManage && changed && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={async () => {
                    const ok = await send('PATCH', `/finance/payout-checks/${c.id}`, {
                      labelEn: e.labelEn,
                      labelAr: e.labelAr,
                      sort: e.sort,
                      ...(c.system ? {} : { active: e.active }),
                    });
                    if (ok)
                      setEdits((m) => {
                        const n = { ...m };
                        delete n[c.id];
                        return n;
                      });
                  }}
                >
                  {t('save')}
                </button>
              )}
              {c.createdBy && (
                <p className="text-caption text-text-muted">
                  {t('createdBy', { name: c.createdBy })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('add')}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-caption">
              {t('code')}
              <input
                value={draft.code}
                dir="ltr"
                onChange={(x) => setDraft({ ...draft, code: x.target.value })}
                className={`${field} mt-1`}
              />
            </label>
            <label className="text-caption">
              {t('labelEn')}
              <input
                value={draft.labelEn}
                dir="ltr"
                onChange={(x) => setDraft({ ...draft, labelEn: x.target.value })}
                className={`${field} mt-1`}
              />
            </label>
            <label className="text-caption">
              {t('labelAr')}
              <input
                value={draft.labelAr}
                dir="rtl"
                onChange={(x) => setDraft({ ...draft, labelAr: x.target.value })}
                className={`${field} mt-1`}
              />
            </label>
          </div>
          <p className="text-caption text-text-muted">{t('codeHint')}</p>
          <button
            type="button"
            className={primary}
            disabled={busy || !draft.code.trim() || !draft.labelEn.trim() || !draft.labelAr.trim()}
            onClick={async () => {
              const ok = await send('POST', '/finance/payout-checks', {
                code: draft.code.trim(),
                labelEn: draft.labelEn.trim(),
                labelAr: draft.labelAr.trim(),
                sort: (checks.at(-1)?.sort ?? 0) + 10,
              });
              if (ok) setDraft({ code: '', labelEn: '', labelAr: '' });
            }}
          >
            {t('add')}
          </button>
        </section>
      )}
      {error && (
        <p role="status" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
