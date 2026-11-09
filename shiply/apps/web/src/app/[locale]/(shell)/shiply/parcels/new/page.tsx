'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { toast } from '@/shell/feedback';
import { SHIPLY_MENU } from '../../menu';
import { useLookups } from '../../shared';

const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'];

export default function NewParcel() {
  const t = useTranslations();
  const router = useRouter();
  const look = useLookups();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      const p = await api<{ id: string }>('/parcels', { method: 'POST', json: { ...f, openPackage: f.openPackage === 'on', merchantRef: f.merchantRef || undefined, notes: f.notes || undefined } });
      router.push(`/shiply/parcels/${p.id}`);
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
      setBusy(false);
    }
  };
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <h1>{t('shiply.newParcel')}</h1>
      <form className="form card" onSubmit={(e) => void submit(e)}>
        <label>
          {t('shiply.merchant')}
          <select name="merchantId" aria-label={t('shiply.merchant')} required defaultValue="">
            <option value="" disabled />
            {look.merchants.map((m) => (
              <option key={m.id} value={m.id}>{`${m.name} · ${m.code}`}</option>
            ))}
          </select>
        </label>
        <label>
          {t('shiply.customerName')}
          <input name="customerName" required />
        </label>
        <label>
          {t('shiply.phone')}
          <input name="phone" required inputMode="tel" dir="ltr" />
        </label>
        <label>
          {t('shiply.address')}
          <textarea name="address" required rows={2} />
        </label>
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
        <label className="check">
          <input type="checkbox" name="openPackage" />
          {t('shiply.openPackage')}
        </label>
        <label>
          {t('shiply.merchantRef')}
          <input name="merchantRef" dir="ltr" />
        </label>
        <label>
          {t('shiply.notes')}
          <input name="notes" />
        </label>
        <button className="btn primary" disabled={busy}>
          {t('shiply.createParcel')}
        </button>
      </form>
    </AppShell>
  );
}
