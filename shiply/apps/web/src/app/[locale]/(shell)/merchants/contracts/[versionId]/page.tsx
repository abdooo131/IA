'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { atLeast, toPiastres } from '@shiply/shared';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { LoadError } from '@/shell/LoadError';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { MERCHANTS_MENU } from '../../menu';

const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'] as const;
const NOW_MONEY = ['deliveryFee', 'orderFixed', 'failedDeliveryFee', 'receivingPerUnit', 'storagePerUnitMonth', 'returnPerUnit', 'packagingCharge'] as const;
const NOW_PERCENT = ['orderPercentBp', 'codPercentBp'] as const;
const PARCEL_MONEY = ['openPackageFee'] as const;
const PARCEL_PERCENT = ['codFeeBp', 'returnFeeBp'] as const;
const TERMS_MONEY = ['minimumPayout', 'minimumMonthlyFee', 'securityDeposit', 'creditLimit'] as const;

interface Version {
  id: string;
  version: number;
  status: string;
  createdById: string;
  payoutSchedule: string;
  promiseMinutes: number;
  deliveryAttempts: number;
  noticeDays: number;
  prices: { pricingZoneId: string; size: string; price: number }[];
  tiers: { minParcels: number; discountBp: number }[];
  contract: { merchant: { id: string; name: string; code: string } };
  [key: string]: unknown;
}
interface Zone {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
}

const egp = (p: unknown) => (Number(p ?? 0) / 100).toFixed(2);
const pct = (bp: unknown) => String(Number(bp ?? 0) / 100);

export default function VersionPage() {
  const t = useTranslations();
  const ar = useLocale() === 'ar';
  const me = useMe();
  const { versionId } = useParams<{ versionId: string }>();
  const [v, setV] = useState<Version | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<{ minParcels: string; discount: string }[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    const [ver, zs] = await Promise.all([api<Version>(`/merchants/contract-versions/${versionId}`), api<Zone[]>('/merchants/pricing-zones')]);
    setV(ver);
    setZones(zs.filter((z) => z.active));
    const f: Record<string, string> = {};
    for (const k of [...NOW_MONEY, ...PARCEL_MONEY, ...TERMS_MONEY]) f[k] = egp(ver[k]);
    for (const k of [...NOW_PERCENT, ...PARCEL_PERCENT]) f[k] = pct(ver[k]);
    f.promiseMinutes = String(ver.promiseMinutes);
    f.deliveryAttempts = String(ver.deliveryAttempts);
    f.noticeDays = String(ver.noticeDays);
    f.payoutSchedule = ver.payoutSchedule;
    setForm(f);
    setPrices(Object.fromEntries(ver.prices.map((p) => [`${p.pricingZoneId}:${p.size}`, egp(p.price)])));
    setTiers(ver.tiers.map((x) => ({ minParcels: String(x.minParcels), discount: pct(x.discountBp) })));
  }, [versionId]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  if (error) return <AppShell app="merchants" menu={MERCHANTS_MENU}><LoadError error={error} onRetry={() => load().catch(setError)} /></AppShell>;
  if (!v) return <AppShell app="merchants" menu={MERCHANTS_MENU}>{null}</AppShell>;

  const editable = v.status === 'draft' && atLeast(me.access.merchants, 'use');
  const canApprove = v.status === 'pending' && atLeast(me.access.sales, 'manage') && v.createdById !== me.id;
  const bp = (s: string) => Math.round(Number(s || 0) * 100);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'merchants'));
    }
  };
  const patch = () =>
      api(`/merchants/contract-versions/${versionId}`, {
        method: 'PATCH',
        json: {
          ...Object.fromEntries([...NOW_MONEY, ...PARCEL_MONEY, ...TERMS_MONEY].map((k) => [k, toPiastres(form[k] || '0')])),
          ...Object.fromEntries([...NOW_PERCENT, ...PARCEL_PERCENT].map((k) => [k, bp(form[k] ?? '0')])),
          promiseMinutes: Number(form.promiseMinutes),
          deliveryAttempts: Number(form.deliveryAttempts),
          noticeDays: Number(form.noticeDays),
          payoutSchedule: form.payoutSchedule,
          prices: Object.entries(prices)
            .filter(([, val]) => val.trim() !== '')
            .map(([key, val]) => {
              const [pricingZoneId, size] = key.split(':');
              return { pricingZoneId, size, price: toPiastres(val) };
            }),
          tiers: tiers.filter((x) => x.minParcels).map((x) => ({ minParcels: Number(x.minParcels), discountBp: bp(x.discount) })),
        },
      });
  const save = () => run(patch);
  // Submitting saves what is on screen first, so nothing typed is lost.
  const submit = () => run(async () => {
    await patch();
    await api(`/merchants/contract-versions/${versionId}/submit`, { method: 'POST' });
  });
  const field = (k: string) => (
    <label key={k}>
      {t(`merchants.fields.${k}`)}
      <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} disabled={!editable} inputMode="decimal" dir="ltr" />
    </label>
  );

  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <Link href={`/merchants/${v.contract.merchant.id}`}>‹ {v.contract.merchant.name}</Link>
      <div className="record-head">
        <h1>
          {v.contract.merchant.code} · {t('merchants.version')} {v.version}
        </h1>
        <span className="pill" data-testid="version-status">
          {t(`merchants.vstatus.${v.status}`)}
        </span>
        <div className="record-actions">
          {editable && (
            <>
              <button className="btn ghost" onClick={() => void save()}>
                {t('merchants.save')}
              </button>
              <button className="btn primary" onClick={() => void submit()}>
                {t('merchants.submit')}
              </button>
            </>
          )}
          {canApprove && (
            <>
              <button
                className="btn primary"
                onClick={() => void confirm({ title: t('merchants.approve'), body: t('merchants.approveVersion') }).then(async (ok) => { if (ok) await run(() => api(`/merchants/contract-versions/${versionId}/approve`, { method: 'POST' })); })}
              >
                {t('merchants.approve')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const reason = window.prompt(t('merchants.rejectReason'));
                  if (reason) void run(() => api(`/merchants/contract-versions/${versionId}/reject`, { method: 'POST', json: { reason } }));
                }}
              >
                {t('merchants.reject')}
              </button>
            </>
          )}
        </div>
      </div>

      <section className="card section">
        <h2>{t('merchants.parcels')}</h2>
        <div className="table-wrap">
          <table className="table price-grid">
            <thead>
              <tr>
                <th />
                {SIZES.map((s) => (
                  <th key={s}>{t(`merchants.sizes.${s}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <th>{ar ? z.nameAr : z.nameEn}</th>
                  {SIZES.map((s) => (
                    <td key={s}>
                      <input
                        aria-label={`${z.nameEn} · ${t(`merchants.sizes.${s}`)}`}
                        value={prices[`${z.id}:${s}`] ?? ''}
                        onChange={(e) => setPrices({ ...prices, [`${z.id}:${s}`]: e.target.value })}
                        disabled={!editable}
                        inputMode="decimal"
                        dir="ltr"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inline-form">{[...PARCEL_PERCENT, ...PARCEL_MONEY, 'deliveryAttempts'].map(field)}</div>
        <h3>{t('merchants.tiers')}</h3>
        {tiers.map((x, i) => (
          <div className="inline-form" key={i}>
            <label>
              {t('merchants.minParcels')}
              <input value={x.minParcels} disabled={!editable} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, minParcels: e.target.value } : y)))} inputMode="numeric" dir="ltr" />
            </label>
            <label>
              {t('merchants.discount')}
              <input value={x.discount} disabled={!editable} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, discount: e.target.value } : y)))} inputMode="decimal" dir="ltr" />
            </label>
          </div>
        ))}
        {editable && (
          <button className="btn ghost" onClick={() => setTiers([...tiers, { minParcels: '', discount: '' }])}>
            {t('merchants.addTier')}
          </button>
        )}
      </section>

      <section className="card section">
        <h2>{t('merchants.now')}</h2>
        <div className="inline-form">{[...NOW_MONEY, ...NOW_PERCENT, 'promiseMinutes'].map(field)}</div>
      </section>

      <section className="card section">
        <h2>{t('merchants.terms')}</h2>
        <div className="inline-form">
          {[...TERMS_MONEY, 'noticeDays'].map(field)}
          <label>
            {t('merchants.fields.payoutSchedule')}
            <select aria-label={t('merchants.fields.payoutSchedule')} value={form.payoutSchedule} disabled={!editable} onChange={(e) => setForm({ ...form, payoutSchedule: e.target.value })}>
              {['weekly', 'twice_weekly', 'daily'].map((s) => (
                <option key={s} value={s}>
                  {t(`merchants.schedules.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </AppShell>
  );
}
