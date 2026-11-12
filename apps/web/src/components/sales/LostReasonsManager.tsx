'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { LostReason } from '@/lib/sales';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/** Sales managers keep the list of reasons a deal is lost; "other" with a note is always there. */
export function LostReasonsManager({ reasons }: { reasons: LostReason[] }) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [draft, setDraft] = useState({ code: '', labelEn: '', labelAr: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorText = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');

  async function add() {
    setBusy(true);
    const result = await apiSend('POST', '/sales/lost-reasons', draft);
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setDraft({ code: '', labelEn: '', labelAr: '' });
    setError(null);
    router.refresh();
  }
  async function toggle(reason: LostReason) {
    const result = await apiSend('PATCH', `/sales/lost-reasons/${reason.code}`, {
      active: !reason.active,
    });
    if (!result.ok) return setError(errorText(result.error));
    router.refresh();
  }

  return (
    <>
      <ul className="mt-4 max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface">
        {reasons.map((r) => (
          <li key={r.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className={r.active ? '' : 'text-text-muted line-through'}>
              <span className="font-bold">{r.labelEn}</span> · <span lang="ar">{r.labelAr}</span>
              <span className="ltr-iso block text-caption text-text-muted">{r.code}</span>
            </span>
            <button type="button" className="btn-secondary" onClick={() => void toggle(r)}>
              {r.active ? t('lostReasons.switchOff') : t('lostReasons.switchOn')}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-6 grid max-w-2xl gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h2 className="text-h3 sm:col-span-3">{t('lostReasons.add')}</h2>
        <label className="text-body-sm">
          <span className="font-semibold">{t('lostReasons.code')}</span>
          <input
            className={`${field} mt-1`}
            dir="ltr"
            required
            pattern="[a-z][a-z0-9_]{1,39}"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          />
        </label>
        <label className="text-body-sm">
          <span className="font-semibold">{t('lostReasons.labelEn')}</span>
          <input
            className={`${field} mt-1`}
            dir="ltr"
            required
            value={draft.labelEn}
            onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
          />
        </label>
        <label className="text-body-sm">
          <span className="font-semibold">{t('lostReasons.labelAr')}</span>
          <input
            className={`${field} mt-1`}
            dir="rtl"
            lang="ar"
            required
            value={draft.labelAr}
            onChange={(e) => setDraft({ ...draft, labelAr: e.target.value })}
          />
        </label>
        <p className="text-caption text-text-muted sm:col-span-3">{t('lostReasons.codeHint')}</p>
        {error && (
          <p role="alert" className="text-body-sm text-danger sm:col-span-3">
            {error}
          </p>
        )}
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('lostReasons.save')}
          </button>
        </div>
      </form>
    </>
  );
}
