'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { toast } from '@/shell/feedback';
import type { Lookups } from '../shared';

const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'];

/** The new parcel form, used in the side panel and on its own page. */
export function NewParcelForm({ merchants, onCreated, onCancel }: { merchants: Lookups['merchants']; onCreated: (id: string) => void; onCancel?: () => void }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      const p = await api<{ id: string }>('/parcels', { method: 'POST', json: { ...f, openPackage: f.openPackage === 'on', merchantRef: f.merchantRef || undefined, notes: f.notes || undefined } });
      onCreated(p.id);
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
      setBusy(false);
    }
  };
  return (
    <form className="stack-form" onSubmit={(e) => void submit(e)}>
      <label>
        {t('shiply.merchant')}
        <select name="merchantId" aria-label={t('shiply.merchant')} required defaultValue="">
          <option value="" disabled />
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>{`${m.name} · ${m.code}`}</option>
          ))}
        </select>
      </label>
      <div className="row2">
        <label>
          {t('shiply.customerName')}
          <input name="customerName" required />
        </label>
        <label>
          {t('shiply.phone')}
          <input name="phone" required inputMode="tel" dir="ltr" />
        </label>
      </div>
      <label>
        {t('shiply.address')}
        <textarea name="address" required rows={3} />
      </label>
      <div className="row2">
        <label>
          {t('shiply.size')}
          <select name="size" aria-label={t('shiply.size')} defaultValue="small">
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {t(`shiply.sizes.${s}` as never)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('shiply.cod')}
          <input name="cod" inputMode="decimal" dir="ltr" defaultValue="0" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" name="openPackage" />
        {t('shiply.openPackage')}
      </label>
      <div className="row2">
        <label>
          {t('shiply.merchantRef')}
          <input name="merchantRef" dir="ltr" />
        </label>
        <label>
          {t('shiply.notes')}
          <input name="notes" />
        </label>
      </div>
      <div className="actions">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button className="btn primary" disabled={busy}>
          {t('shiply.createParcel')}
        </button>
      </div>
    </form>
  );
}
