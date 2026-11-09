'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { MERCHANTS_MENU } from '../menu';

export default function NewMerchant() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const f = Object.fromEntries(fd) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const m = await api<{ id: string }>('/merchants', {
        method: 'POST',
        json: { name: f.name, contactName: f.contactName, contactPhone: f.contactPhone, contactEmail: f.contactEmail || undefined, services: fd.getAll('services'), pickupAddress: f.pickupAddress || undefined },
      });
      router.push(`/merchants/${m.id}`);
    } catch (err) {
      setError(errorText(t, err, 'merchants'));
      setBusy(false);
    }
  }
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU} need="use">
      <h1>{t('merchants.newMerchant')}</h1>
      <form className="form card" onSubmit={submit}>
        <label>
          {t('merchants.name')}
          <input name="name" required maxLength={200} />
        </label>
        <label>
          {t('merchants.contactName')}
          <input name="contactName" required maxLength={200} />
        </label>
        <label>
          {t('merchants.contactPhone')}
          <input name="contactPhone" required inputMode="tel" dir="ltr" />
        </label>
        <label>
          {t('merchants.contactEmail')}
          <input name="contactEmail" type="email" dir="ltr" />
        </label>
        <fieldset className="checks">
          <legend>{t('merchants.services')}</legend>
          <label>
            <input type="checkbox" name="services" value="shiply_now" /> {t('apps.shiply_now')}
          </label>
          <label>
            <input type="checkbox" name="services" value="shiply" /> {t('apps.shiply')}
          </label>
        </fieldset>
        <label>
          {t('merchants.pickupAddress')}
          <textarea name="pickupAddress" rows={2} dir="auto" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {t('merchants.createMerchant')}
        </button>
      </form>
    </AppShell>
  );
}
