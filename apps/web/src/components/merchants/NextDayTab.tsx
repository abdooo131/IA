'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';

interface NextDay {
  id: string;
  code: string | null;
  pickupAddress: string | null;
  governorateCode: string | null;
  areaId: string | null;
  homeHub: { id: string; code: string; name: string } | null;
  flexShip: boolean;
  ready: boolean;
  parcelsThisMonth: number;
  lastParcelAt: string | null;
}
interface Governorate {
  code: string;
  nameEn: string;
  nameAr: string;
  served: boolean;
  areas: { id: string; nameEn: string; nameAr: string }[];
}

const field = 'mt-1 h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';

/**
 * The merchant's next day parcels (Shiply) on the one merchant page: where we pick up, the
 * sorting facility the system picked, the merchant code on labels and FlexShip. Prices are in
 * the contract. Needs Shiply access; without it the tab says so.
 */
export function NextDayTab({ merchantId, locale }: { merchantId: string; locale: string }) {
  const t = useTranslations('admin.merchantPage.nextDay');
  const [data, setData] = useState<NextDay | null>(null);
  const [govs, setGovs] = useState<Governorate[]>([]);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState({
    code: '',
    pickupAddress: '',
    governorateCode: '',
    areaId: '',
    flexShip: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [d, g] = await Promise.all([
        apiGetClient<NextDay>(`/parcels/admin/merchants/${merchantId}/next-day`),
        apiGetClient<Governorate[]>('/parcels/reference/locations'),
      ]);
      if (!d.ok) return setDenied(true);
      setData(d.data);
      if (g.ok) setGovs(g.data);
      setForm({
        code: d.data.code ?? '',
        pickupAddress: d.data.pickupAddress ?? '',
        governorateCode: d.data.governorateCode ?? '',
        areaId: d.data.areaId ?? '',
        flexShip: d.data.flexShip,
      });
    })();
  }, [merchantId]);

  if (denied) return <p className="text-body-sm text-text-muted">{t('noAccess')}</p>;
  if (!data) return <p className="text-body-sm text-text-muted">{t('loading')}</p>;
  const gov = govs.find((g) => g.code === form.governorateCode);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await apiSend<NextDay>('PUT', `/parcels/admin/merchants/${merchantId}/next-day`, {
      ...form,
      areaId: form.areaId || null,
    });
    setBusy(false);
    if (!r.ok) return setMessage(t('error'));
    setData(r.data);
    setMessage(t('saved'));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <h2 className="text-h3">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
        <dl className="mt-3 space-y-2 text-body-sm">
          <div className="flex justify-between gap-2">
            <dt>{t('status')}</dt>
            <dd className="font-bold">{data.ready ? t('ready') : t('notReady')}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t('facility')}</dt>
            <dd className="font-bold">
              {data.homeHub ? `${data.homeHub.code} · ${data.homeHub.name}` : t('none')}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t('parcelsThisMonth')}</dt>
            <dd className="font-bold">{data.parcelsThisMonth}</dd>
          </div>
        </dl>
        <p className="mt-3 text-body-sm">{t('pricesInContract')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn-secondary" href={`/admin/merchants/${merchantId}?tab=contract`}>
            {t('openContract')}
          </Link>
          <Link className="btn-secondary" href="/parcels/admin/shipments">
            {t('openParcels')}
          </Link>
        </div>
      </section>
      <form
        onSubmit={(e) => void save(e)}
        className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
      >
        <h2 className="text-h3">{t('setup')}</h2>
        <label className="block text-body-sm">
          {t('code')}
          <input
            className={field}
            dir="ltr"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </label>
        <label className="block text-body-sm">
          {t('pickupAddress')}
          <input
            className={field}
            value={form.pickupAddress}
            onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
          />
        </label>
        <label className="block text-body-sm">
          {t('governorate')}
          <select
            className={field}
            value={form.governorateCode}
            onChange={(e) => setForm({ ...form, governorateCode: e.target.value, areaId: '' })}
          >
            <option value="">{t('choose')}</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code}>
                {name(g)}
              </option>
            ))}
          </select>
        </label>
        {gov && gov.areas.length > 0 && (
          <label className="block text-body-sm">
            {t('area')}
            <select
              className={field}
              value={form.areaId}
              onChange={(e) => setForm({ ...form, areaId: e.target.value })}
            >
              <option value="">{t('choose')}</option>
              {gov.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.flexShip}
            onChange={(e) => setForm({ ...form, flexShip: e.target.checked })}
          />
          {t('flexShip')}
        </label>
        <p className="text-caption text-text-muted">{t('facilityHint')}</p>
        {message && <p className="text-body-sm">{message}</p>}
        <button type="submit" className="btn-primary h-10" disabled={busy}>
          {t('save')}
        </button>
      </form>
    </div>
  );
}
