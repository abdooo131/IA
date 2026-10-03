'use client';

import { Button, Card, ErrorBox, Field, inputClass, LangToggle, useApp, useAsync } from '@shiply/ui';
import { FormEvent, useState } from 'react';

interface Pickup { id: string; name: string; governorateCode: string; area: string; addressLine: string; isDefault: boolean }
interface Gov { code: string; nameEn: string; nameAr: string }
interface Merchant { nameEn: string; nameAr: string; code: string; tier: string; vatEnabled: boolean; cashoutFrequency: string }

export default function SettingsPage() {
  const { api, t, lang, setLang, session } = useApp();
  const merchant = useAsync(() => api.get<Merchant>('/merchant/me'), []);
  const pickups = useAsync(() => api.get<Pickup[]>('/merchant/pickup-locations'), []);
  const govs = useAsync(() => api.get<Gov[]>('/reference/governorates'), []);
  const [form, setForm] = useState({ name: '', governorateCode: 'CAI', area: '', addressLine: '', isDefault: false });
  const [error, setError] = useState<unknown>(null);
  const isOwner = session?.user.role === 'MERCHANT_OWNER';

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/merchant/pickup-locations', form);
      setForm({ name: '', governorateCode: 'CAI', area: '', addressLine: '', isDefault: false });
      pickups.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function act(path: string) {
    setError(null);
    try {
      await api.patch(path);
      pickups.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t.settings}</h1>

      {merchant.data && (
        <Card title={lang === 'ar' ? merchant.data.nameAr : merchant.data.nameEn}>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Code</dt><dd>{merchant.data.code}</dd></div>
            <div><dt className="text-xs text-slate-500">Tier</dt><dd>{merchant.data.tier}</dd></div>
            <div><dt className="text-xs text-slate-500">{t.vat}</dt><dd>{merchant.data.vatEnabled ? t.yes : t.no}</dd></div>
            <div><dt className="text-xs text-slate-500">{t.nextCashout}</dt><dd>{merchant.data.cashoutFrequency}</dd></div>
          </dl>
        </Card>
      )}

      <Card title={t.language}>
        <div className="flex items-center gap-3 text-sm">
          <span>{lang === 'ar' ? 'العربية' : 'English'}</span>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
      </Card>

      <Card title={t.pickupLocations}>
        <ErrorBox error={error} />
        <ul className="divide-y divide-slate-100">
          {(pickups.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <div className="font-medium">
                  {p.name} {p.isDefault && <span className="ms-2 rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-800">{t.default}</span>}
                </div>
                <div className="text-slate-600">{p.addressLine}, {p.area} ({p.governorateCode})</div>
              </div>
              {isOwner && (
                <div className="flex gap-2">
                  {!p.isDefault && <Button variant="ghost" onClick={() => act(`/merchant/pickup-locations/${p.id}/default`)}>{t.makeDefault}</Button>}
                  <Button variant="ghost" onClick={() => act(`/merchant/pickup-locations/${p.id}/archive`)}>{t.archive}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form onSubmit={add} className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <Field label={t.name}><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label={t.governorate}>
              <select className={inputClass} value={form.governorateCode} onChange={(e) => setForm({ ...form, governorateCode: e.target.value })}>
                {(govs.data ?? []).map((g) => <option key={g.code} value={g.code}>{lang === 'ar' ? g.nameAr : g.nameEn}</option>)}
              </select>
            </Field>
            <Field label={t.area}><input className={inputClass} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} required /></Field>
            <Field label={t.address}><input className={inputClass} value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} required /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> {t.default}
            </label>
            <div className="flex justify-end"><Button type="submit">{t.addLocation}</Button></div>
          </form>
        )}
      </Card>
    </div>
  );
}
