'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { LoadError } from '@/shell/LoadError';
import { RecordPage } from '@/shell/RecordPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { MERCHANTS_MENU } from '../menu';

interface Merchant {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  services: string[];
  status: string;
  taxNumber: string | null;
  iban: string | null;
  bankName: string | null;
  pickupAddress: string | null;
  pickupPlaceId: string | null;
  pickupPath: { id: string; nameEn: string; nameAr: string }[];
  users: { userId: string; role: string; login?: { name: string; email: string | null; mobile: string | null; active: boolean } }[];
  shops: { id: string; domain: string; connectedAt: string }[];
}
interface Version {
  id: string;
  version: number;
  status: string;
  startDate: string;
  approvedAt: string | null;
}
interface Product {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  price: number;
  active: boolean;
}

const egp = (p: number) => (p / 100).toFixed(2);

export default function MerchantPage() {
  const t = useTranslations();
  const ar = useLocale() === 'ar';
  const me = useMe();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [m, setM] = useState<Merchant | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const load = useCallback(async () => {
    setM(await api<Merchant>(`/merchants/${id}`));
    setVersions((await api<{ versions: Version[] }>(`/merchants/${id}/contract`)).versions);
    setProducts((await api<{ rows: Product[] }>(`/merchants/${id}/products`)).rows);
  }, [id]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  if (error) return <AppShell app="merchants" menu={MERCHANTS_MENU}><LoadError error={error} onRetry={() => load().catch(setError)} /></AppShell>;
  if (!m) return <AppShell app="merchants" menu={MERCHANTS_MENU}>{null}</AppShell>;
  const canUse = atLeast(me.access.merchants, 'use');
  const canManage = atLeast(me.access.merchants, 'manage');
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'merchants'));
    }
  };
  const formAct = (url: string, build: (f: Record<string, string>) => object) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    await act(async () => {
      await api(url, { method: 'POST', json: build(f) });
      form.reset();
    });
  };
  const newDraft = async () => {
    try {
      const d = await api<{ id: string }>(`/merchants/${id}/contract/drafts`, { method: 'POST' });
      router.push(`/merchants/contracts/${d.id}`);
    } catch (err) {
      toast.error(errorText(t, err, 'merchants'));
    }
  };
  const later = (key: string) => <p className="muted">{t(`merchants.${key}`)}</p>;

  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <RecordPage
        back={<Link href="/merchants/list">‹ {t('merchants.merchants')}</Link>}
        number={`${m.name} · ${m.code}`}
        status={<span className={`pill${m.status === 'approved' ? ' on' : ''}`}>{t(`merchants.statuses.${m.status}`)}</span>}
        actions={
          canManage ? (
            <>
              {m.status === 'pending' && (
                <button className="btn primary" onClick={() => void confirm({ title: t('merchants.approve'), body: t('merchants.approveBody') }).then(async (ok) => { if (ok) await act(() => api(`/merchants/${id}/approve`, { method: 'POST' })); })}>
                  {t('merchants.approve')}
                </button>
              )}
              {m.status !== 'inactive' && m.status !== 'rejected' && (
                <button className="btn danger" onClick={() => void confirm({ title: t('merchants.deactivate'), body: t('merchants.deactivateBody'), danger: true }).then(async (ok) => { if (ok) await act(() => api(`/merchants/${id}/deactivate`, { method: 'POST' })); })}>
                  {t('merchants.deactivate')}
                </button>
              )}
            </>
          ) : undefined
        }
        tabs={[
          {
            key: 'overview',
            label: t('merchants.tabs.overview'),
            content: (
              <dl className="fields">
                <dt>{t('merchants.contactName')}</dt>
                <dd>{m.contactName}</dd>
                <dt>{t('merchants.contactPhone')}</dt>
                <dd dir="ltr">{m.contactPhone}</dd>
                <dt>{t('merchants.contactEmail')}</dt>
                <dd>{m.contactEmail ?? ''}</dd>
                <dt>{t('merchants.pickupAddress')}</dt>
                <dd dir="auto">{m.pickupAddress ?? ''}</dd>
                <dt>{t('merchants.pickupArea')}</dt>
                <dd>{m.pickupPath.length ? m.pickupPath.map((p) => (ar ? p.nameAr : p.nameEn)).join(' › ') : m.pickupAddress ? <span className="muted">{t('merchants.waitingLocation')}</span> : ''}</dd>
                <dt>{t('merchants.legalName')}</dt>
                <dd>{m.legalName ?? ''}</dd>
                <dt>{t('merchants.taxNumber')}</dt>
                <dd>{m.taxNumber ?? ''}</dd>
                <dt>{t('merchants.bankName')}</dt>
                <dd>{[m.bankName, m.iban].filter(Boolean).join(' · ')}</dd>
              </dl>
            ),
          },
          { key: 'services', label: t('merchants.tabs.services'), content: <p>{m.services.map((s) => t(`apps.${s}`)).join(' + ')}</p> },
          {
            key: 'contract',
            label: t('merchants.tabs.contract'),
            content: (
              <div className="form-wide">
                {canUse && (
                  <div>
                    <button className="btn primary" onClick={() => void newDraft()}>
                      {t('merchants.newDraft')}
                    </button>
                  </div>
                )}
                <table className="table">
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td>
                          {t('merchants.version')} {v.version}
                        </td>
                        <td>{t(`merchants.vstatus.${v.status}`)}</td>
                        <td>{new Date(v.startDate).toLocaleDateString()}</td>
                        <td>
                          <Link href={`/merchants/contracts/${v.id}`}>{t('merchants.open')}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
          {
            key: 'products',
            label: t('merchants.tabs.products'),
            content: (
              <div className="form-wide">
                {canUse && (
                  <form className="inline-form" onSubmit={formAct(`/merchants/${id}/products`, (f) => ({ sku: f.sku, nameEn: f.nameEn, nameAr: f.nameAr, price: f.price }))}>
                    <label>
                      {t('merchants.sku')}
                      <input name="sku" required dir="ltr" />
                    </label>
                    <label>
                      {t('merchants.productName')}
                      <input name="nameEn" required />
                    </label>
                    <label>
                      {t('merchants.productNameAr')}
                      <input name="nameAr" required dir="rtl" />
                    </label>
                    <label>
                      {t('merchants.price')}
                      <input name="price" required inputMode="decimal" dir="ltr" />
                    </label>
                    <button className="btn primary">{t('merchants.addProduct')}</button>
                  </form>
                )}
                <table className="table">
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>{p.sku}</td>
                        <td>{ar ? p.nameAr : p.nameEn}</td>
                        <td>{egp(p.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
          { key: 'money', label: t('merchants.tabs.money'), content: later('laterAccounting') },
          {
            key: 'users',
            label: t('merchants.tabs.users'),
            content: (
              <div className="form-wide">
                {canUse && (
                  <form className="inline-form" onSubmit={formAct(`/merchants/${id}/users`, (f) => ({ name: f.name, nameAr: f.nameAr, email: f.email || undefined, mobile: f.mobile || undefined, password: f.password, role: f.role }))}>
                    <label>
                      {t('merchants.loginName')}
                      <input name="name" required />
                    </label>
                    <label>
                      {t('merchants.loginNameAr')}
                      <input name="nameAr" required dir="rtl" />
                    </label>
                    <label>
                      {t('merchants.email')}
                      <input name="email" type="email" dir="ltr" />
                    </label>
                    <label>
                      {t('merchants.mobile')}
                      <input name="mobile" inputMode="tel" dir="ltr" />
                    </label>
                    <label>
                      {t('merchants.password')}
                      <input name="password" type="password" required minLength={8} autoComplete="new-password" />
                    </label>
                    <label>
                      {t('merchants.role')}
                      <select name="role" aria-label={t('merchants.role')} defaultValue="staff">
                        <option value="owner">{t('merchants.roles.owner')}</option>
                        <option value="staff">{t('merchants.roles.staff')}</option>
                      </select>
                    </label>
                    <button className="btn primary">{t('merchants.addLogin')}</button>
                  </form>
                )}
                <table className="table">
                  <tbody>
                    {m.users.map((u) => (
                      <tr key={u.userId}>
                        <td>{u.login?.name}</td>
                        <td dir="ltr">{u.login?.email ?? u.login?.mobile}</td>
                        <td>{t(`merchants.roles.${u.role}`)}</td>
                        <td>{u.login?.active ? t('merchants.statuses.approved') : t('merchants.statuses.inactive')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
          {
            key: 'integrations',
            label: t('merchants.tabs.integrations'),
            content: (
              <div className="form-wide">
                {canUse && (
                  <form className="inline-form" onSubmit={formAct(`/merchants/${id}/shopify`, (f) => ({ domain: f.domain }))}>
                    <label>
                      {t('merchants.domain')}
                      <input name="domain" required dir="ltr" />
                    </label>
                    <button className="btn primary">{t('merchants.addShop')}</button>
                  </form>
                )}
                <ul>
                  {m.shops.map((s) => (
                    <li key={s.id} dir="ltr">
                      {s.domain}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          { key: 'documents', label: t('merchants.tabs.documents'), content: later('laterFiles') },
        ]}
        timeline={[]}
      />
    </AppShell>
  );
}
