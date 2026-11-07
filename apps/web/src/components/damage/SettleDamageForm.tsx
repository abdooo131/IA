'use client';

import { DAMAGE_CAUSES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { COMPANY_CAUSES, type DamageCause, type DamageReportRow } from '@/lib/damage-types';
import { formatEgp } from '@/lib/format';

const KNOWN = ['note_required', 'rider_charge_not_allowed', 'damage_already_settled'];

/** Admin confirms (or changes) the cause; the amount follows the rule, never typed. */
export function SettleDamageForm({ row }: { row: DamageReportRow }) {
  const t = useTranslations('damage');
  const router = useRouter();
  const [cause, setCause] = useState<DamageCause>(row.cause);
  const [chargeRider, setChargeRider] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const companyPays = COMPANY_CAUSES.includes(cause);
  const canCharge = cause === 'delivery' && row.rider !== null;

  async function settle() {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/admin/damage/${row.id}/settle`, {
      cause,
      chargeRider: canCharge && chargeRider,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    router.refresh();
  }

  const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cause}
          onChange={(e) => setCause(e.target.value as DamageCause)}
          aria-label={t('cause')}
          className={field}
        >
          {DAMAGE_CAUSES.map((c) => (
            <option key={c} value={c}>
              {t(`causes.${c}`)}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={cause === row.cause ? t('noteOptional') : t('noteRequired')}
          maxLength={300}
          className={`${field} min-w-48 flex-1`}
        />
      </div>
      {canCharge && (
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={chargeRider}
            onChange={(e) => setChargeRider(e.target.checked)}
          />
          {t('chargeRider', { name: row.rider!.name })}
        </label>
      )}
      <p className="text-body-sm">
        {companyPays
          ? t('weCompensate', { amount: formatEgp(row.valuePiastres) })
          : t('merchantBears')}
      </p>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void settle()}
        className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
      >
        {t('settle')}
      </button>
    </div>
  );
}
