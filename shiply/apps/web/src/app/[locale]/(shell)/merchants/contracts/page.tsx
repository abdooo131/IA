'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { MERCHANTS_MENU } from '../menu';

interface Pending {
  id: string;
  version: number;
  submittedAt: string;
  contract: { merchant: { name: string; code: string } };
}
interface Zone {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  areas: { placeId: string }[];
}
interface Gov {
  id: string;
  nameEn: string;
  nameAr: string;
}

export default function ContractsPage() {
  const t = useTranslations();
  const ar = useLocale() === 'ar';
  const me = useMe();
  const router = useRouter();
  const [tab, setTab] = useState<'pending' | 'zones'>('pending');
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [govs, setGovs] = useState<Gov[]>([]);
  const canManage = atLeast(me.access.merchants, 'manage');
  const load = useCallback(async () => {
    setPending((await api<{ rows: Pending[] }>('/merchants/contracts/pending')).rows);
    setZones(await api<Zone[]>('/merchants/pricing-zones'));
    setGovs((await api<{ rows: Gov[] }>('/location/places?kind=governorate')).rows);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const fail = (err: unknown) => toast.error(errorText(t, err, 'merchants'));
  const addZone = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api('/merchants/pricing-zones', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
      await load();
    } catch (err) {
      fail(err);
    }
  };
  const toggle = async (z: Zone, placeId: string, on: boolean) => {
    const ids = on ? [...z.areas.map((a) => a.placeId), placeId] : z.areas.map((a) => a.placeId).filter((x) => x !== placeId);
    try {
      await api(`/merchants/pricing-zones/${z.id}/areas`, { method: 'PUT', json: { placeIds: ids } });
      await load();
    } catch (err) {
      fail(err);
    }
  };
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <h1>{t('merchants.contracts')}</h1>
      <div className="tabs" role="tablist">
        {(['pending', 'zones'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'tab active' : 'tab'} onClick={() => setTab(x)}>
            {x === 'pending' ? t('merchants.pendingApproval') : t('merchants.pricingZones')}
          </button>
        ))}
      </div>
      {tab === 'pending' ? (
        <ListPage<Pending>
          title={t('merchants.pendingApproval')}
          columns={[
            { key: 'merchant', label: t('merchants.merchant'), render: (r) => `${r.contract.merchant.name} · ${r.contract.merchant.code}` },
            { key: 'version', label: t('merchants.version') },
            { key: 'submittedAt', label: t('merchants.submitted'), render: (r) => new Date(r.submittedAt).toLocaleString() },
          ]}
          rows={pending ?? []}
          total={pending?.length ?? 0}
          page={1}
          pageSize={500}
          onPage={() => undefined}
          loading={!pending}
          onRowClick={(r) => router.push(`/merchants/contracts/${r.id}`)}
        />
      ) : (
        <section>
          {canManage && (
            <form className="inline-form card" onSubmit={addZone}>
              <label>
                {t('merchants.zoneCode')}
                <input name="code" required dir="ltr" />
              </label>
              <label>
                {t('merchants.zoneName')}
                <input name="nameEn" required />
              </label>
              <label>
                {t('merchants.zoneNameAr')}
                <input name="nameAr" required dir="rtl" />
              </label>
              <button className="btn primary">{t('merchants.addZone')}</button>
            </form>
          )}
          {zones.map((z) => (
            <div key={z.id} className="card section">
              <h2>
                {z.code} · {ar ? z.nameAr : z.nameEn}
              </h2>
              <div className="checks">
                {govs.map((g) => {
                  const mine = z.areas.some((a) => a.placeId === g.id);
                  const taken = !mine && zones.some((o) => o.areas.some((a) => a.placeId === g.id));
                  return (
                    <label key={g.id} className={taken ? 'muted' : undefined}>
                      <input type="checkbox" checked={mine} disabled={!canManage || taken} onChange={(e) => void toggle(z, g.id, e.target.checked)} /> {ar ? g.nameAr : g.nameEn}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </AppShell>
  );
}
