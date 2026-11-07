'use client';
import { useEffect, useState } from 'react';
import { DAY_NAMES } from '@/components/workforce';
import { useRunner } from '@/components/money';
import { Button, Card, Field, Input, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** The store logo on the tracking page, and pickups booked by themselves on chosen days. */
export default function MerchantSettings() {
  const t = useT();
  const rec = useLoad<{ weekdays: number[]; active: boolean; notes: string }>('/merchant/recurring-pickup');
  const r = useRunner(() => rec.reload());
  const [days, setDays] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!rec.data) return;
    setDays(rec.data.weekdays);
    setNotes(rec.data.notes);
    setActive(rec.data.active);
  }, [rec.data]);
  const upload = (file: File | undefined) =>
    file &&
    r.run(async () => {
      if (file.size > 500 * 1024) throw new Error('The logo must be under 500 KB');
      const dataBase64 = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.readAsDataURL(file);
      });
      await api('/merchant/logo', { method: 'PUT', body: { mime: file.type, dataBase64 } });
    }, 'Logo saved. Customers see it on the tracking page');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Settings')} subtitle={t('Your logo and your regular pickups')} />
      {r.view}
      <Card title={t('Logo on the tracking page')}>
        <label className="btn-secondary cursor-pointer">
          {t('Upload logo')}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <p className="mt-2 text-caption text-text-muted">{t('PNG, JPG or WebP, under 500 KB')}</p>
      </Card>
      <Card title={t('Regular pickups')}>
        {!rec.data ? <Loading /> : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void r.run(() => api('/merchant/recurring-pickup', { method: 'PUT', body: { weekdays: days, active, notes } }), 'Saved'); }}>
            <p className="text-body-sm text-text-muted">{t('On these days we book a pickup for you each morning, when you have parcels waiting')}</p>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((d, i) => (
                <label key={d} className={`flex min-h-9 cursor-pointer items-center rounded-md border px-3 text-body-sm ${days.includes(i) ? 'border-accent bg-selected-bg font-bold' : 'border-line'}`}>
                  <input type="checkbox" className="sr-only" checked={days.includes(i)} onChange={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} />
                  {t(d)}
                </label>
              ))}
            </div>
            <Field label={t('Notes for the pickup courier')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('On')}</label>
            <Button type="submit">{t('Save')}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
