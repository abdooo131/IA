'use client';

import { egpToPiastres, ORDER_TYPES, PACKAGE_SIZES } from '@shiply/shared';
import { ApiError, Button, Card, ErrorBox, Field, inputClass, SIZE_LABELS, TYPE_LABELS, useApp, useAsync } from '@shiply/ui';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

interface Gov { code: string; nameEn: string; nameAr: string }
interface Area { id: string; nameEn: string; nameAr: string }
interface Pickup { id: string; name: string; area: string; isDefault: boolean }

export default function NewOrderPage() {
  const { api, t, lang } = useApp();
  const router = useRouter();
  const govs = useAsync(() => api.get<Gov[]>('/reference/governorates'), []);
  const pickups = useAsync(() => api.get<Pickup[]>('/merchant/pickup-locations'), []);
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerPhoneAlt: '',
    governorateCode: 'CAI',
    area: '',
    addressLine: '',
    cod: '',
    size: 'SMALL_MEDIUM',
    type: 'DELIVER',
    allowOpenPackage: false,
    itemsDescription: '',
    returnItemsDescription: '',
    merchantReference: '',
    notes: '',
    pickupLocationId: '',
  });
  const areas = useAsync(() => api.get<Area[]>(`/reference/areas?governorateCode=${form.governorateCode}`), [form.governorateCode]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const cod = egpToPiastres(form.cod || '0');
    if (cod === null) {
      setFieldErrors({ codAmount: 'Enter an amount like 450 or 450.50' });
      return;
    }
    setBusy(true);
    try {
      const order = await api.post<{ id: string }>('/orders', {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerPhoneAlt: form.customerPhoneAlt || null,
        governorateCode: form.governorateCode,
        area: form.area,
        addressLine: form.addressLine,
        codAmount: cod,
        size: form.size,
        type: form.type,
        allowOpenPackage: form.allowOpenPackage,
        itemsDescription: form.itemsDescription || null,
        returnItemsDescription: form.returnItemsDescription || null,
        merchantReference: form.merchantReference || null,
        notes: form.notes || null,
        pickupLocationId: form.pickupLocationId || null,
      });
      router.push(`/orders/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.body?.errors)) {
        setFieldErrors(Object.fromEntries(err.body.errors.map((x: { path: string; message: string }) => [x.path, x.message])));
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-text">{t.newOrder}</h1>
      <Card title={t.customer}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.customerName} error={fieldErrors.customerName}>
            <input className={inputClass} name="customerName" value={form.customerName} onChange={set('customerName')} required />
          </Field>
          <Field label={t.customerPhone} error={fieldErrors.customerPhone} hint="01XXXXXXXXX">
            <input className={inputClass} name="customerPhone" dir="ltr" value={form.customerPhone} onChange={set('customerPhone')} required />
          </Field>
          <Field label={t.altPhone} error={fieldErrors.customerPhoneAlt}>
            <input className={inputClass} name="customerPhoneAlt" dir="ltr" value={form.customerPhoneAlt} onChange={set('customerPhoneAlt')} />
          </Field>
          <Field label={t.governorate} error={fieldErrors.governorateCode}>
            <select className={inputClass} name="governorateCode" value={form.governorateCode} onChange={set('governorateCode')}>
              {(govs.data ?? []).map((g) => (
                <option key={g.code} value={g.code}>{lang === 'ar' ? g.nameAr : g.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label={t.area} error={fieldErrors.area}>
            <input className={inputClass} name="area" list="areas" value={form.area} onChange={set('area')} required />
            <datalist id="areas">
              {(areas.data ?? []).map((a) => (
                <option key={a.id} value={lang === 'ar' ? a.nameAr : a.nameEn} />
              ))}
            </datalist>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t.address} error={fieldErrors.addressLine}>
              <textarea className={inputClass} name="addressLine" rows={2} value={form.addressLine} onChange={set('addressLine')} required />
            </Field>
          </div>
        </div>
      </Card>

      <Card title={t.details}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.type}>
            <select className={inputClass} name="type" value={form.type} onChange={set('type')}>
              {ORDER_TYPES.map((x) => (
                <option key={x} value={x}>{TYPE_LABELS[lang][x]}</option>
              ))}
            </select>
          </Field>
          <Field label={t.size}>
            <select className={inputClass} name="size" value={form.size} onChange={set('size')}>
              {PACKAGE_SIZES.map((x) => (
                <option key={x} value={x}>{SIZE_LABELS[lang][x]}</option>
              ))}
            </select>
          </Field>
          <Field label={t.codAmount} error={fieldErrors.codAmount}>
            <input className={inputClass} name="cod" inputMode="decimal" dir="ltr" value={form.cod} onChange={set('cod')} placeholder="0" disabled={form.type === 'RETURN'} />
          </Field>
          <Field label={t.pickupLocation} error={fieldErrors.pickupLocationId}>
            <select className={inputClass} name="pickupLocationId" value={form.pickupLocationId} onChange={set('pickupLocationId')}>
              {(pickups.data ?? []).map((p) => (
                <option key={p.id} value={p.isDefault ? '' : p.id}>{p.name} ({p.area}){p.isDefault ? ` · ${t.default}` : ''}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="allowOpenPackage" checked={form.allowOpenPackage} onChange={set('allowOpenPackage')} />
            {t.allowOpen}
          </label>
          <Field label={t.items}>
            <input className={inputClass} name="itemsDescription" value={form.itemsDescription} onChange={set('itemsDescription')} />
          </Field>
          {form.type !== 'DELIVER' && (
            <Field label={t.returnItems}>
              <input className={inputClass} name="returnItemsDescription" value={form.returnItemsDescription} onChange={set('returnItemsDescription')} />
            </Field>
          )}
          <Field label={t.reference}>
            <input className={inputClass} name="merchantReference" value={form.merchantReference} onChange={set('merchantReference')} />
          </Field>
          <Field label={t.notes}>
            <input className={inputClass} name="notes" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <p className="mt-4 text-xs text-muted">{t.priceFrozen}</p>
      </Card>

      <ErrorBox error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? t.creating : t.create}</Button>
      </div>
    </form>
  );
}
