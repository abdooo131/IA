import { cairoDay, canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Readiness, type ShopifyOverview } from '@/components/admin/ShopifyManager';
import { ContractTab } from '@/components/contracts/ContractTab';
import { Amount } from '@/components/finance/Amount';
import { type MerchantProfitDetail, ProfitSummaryCard } from '@/components/finance/MerchantProfit';
import { TabLinks } from '@/components/hr/HrPage';
import { BackLink } from '@/components/store/BackLink';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ContractView } from '@/lib/contracts';
import { formatCairoDateTime } from '@/lib/format';
import { merchantTabs, type MerchantTab, pickMerchantTab } from '@/lib/merchant-page';

export const dynamic = 'force-dynamic';

interface MerchantOverview {
  merchant: {
    id: string;
    name: string;
    legalName: string | null;
    isActive: boolean;
    approval: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    contactEmail: string | null;
    contactPhone: string | null;
    shopifyShopDomain: string | null;
    payoutSchedule: string;
    expressPricePiastres: number | null;
    accountManager: { id: string; name: string } | null;
  };
  onboarding: { products: boolean; price: boolean; shopify: boolean; shipment: boolean };
  month: {
    month: string;
    ordersPlaced: number;
    ordersDelivered: number;
    feesByKind: Record<string, number>;
    feesPiastres: number;
  };
  owedPiastres: number;
  products: {
    skus: number;
    activeSkus: number;
    openShipments: number;
    openReturns: number;
    stores: {
      darkStoreId: string;
      code: string;
      nameEn: string;
      nameAr: string;
      onHand: number;
      reserved: number;
    }[];
  };
  users: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    merchantRole: 'owner' | 'member' | null;
    merchantRights: string[];
    isActive: boolean;
    createdAt: string;
  }[];
}

const card = 'rounded-lg border border-line bg-surface p-4 shadow-sm';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-raised p-3">
      <p className="text-caption text-text-muted">{label}</p>
      <p className="mt-1 break-words text-body font-bold">{children}</p>
    </div>
  );
}

/**
 * One merchant (Merchants app): tabs kept in the address (?tab=) for the overview, the
 * contract (every price, tier, payment term and promise, with versions, files and the printed
 * copy), Shopify readiness, products and stock, the merchant's team, profit (Accounting) and
 * history.
 */
export default async function AdminMerchantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; version?: string }>;
}) {
  const { id } = await params;
  const { tab: asked, version } = await searchParams;
  const [overview, profile, t, locale] = await Promise.all([
    apiGet<MerchantOverview>(`/admin/merchants/${id}/overview`),
    getMyProfile(),
    getTranslations('admin.merchantPage'),
    getLocale(),
  ]);
  const canProfit = canDo(profile, 'accounting', 'view');
  const tabs = merchantTabs({ canProfit });
  const tab: MerchantTab = pickMerchantTab(asked, tabs);
  const today = cairoDay(new Date());
  const m = overview.merchant;
  const contract =
    tab === 'contract' || tab === 'overview'
      ? await apiGet<ContractView>(`/admin/merchants/${id}/contract`)
      : null;
  const month = today.slice(0, 7);

  return (
    <>
      <BackLink href="/admin/merchants" />
      <header className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-h2">{m.name}</h1>
          <p className="text-body-sm text-text-muted">
            {m.isActive ? t('active') : t('paused')} · {t(`approval.${m.approval}`)}
            {m.legalName && ` · ${m.legalName}`}
          </p>
        </div>
      </header>
      <TabLinks
        tabs={tabs}
        current={tab}
        href={(k) => `/admin/merchants/${id}?tab=${k}`}
        label={(k) => t(`tabs.${k}`)}
        ariaLabel={t('tabsLabel')}
      />
      <div className="mt-4">
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={card}>
              <h2 className="text-h3">{t('overview.who')}</h2>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <Stat label={t('overview.accountManager')}>
                  {m.accountManager?.name ?? t('overview.none')}
                </Stat>
                <Stat label={t('overview.since')}>{formatCairoDateTime(m.createdAt, locale)}</Stat>
                <Stat label={t('overview.email')}>
                  <span className="break-all">{m.contactEmail ?? t('overview.none')}</span>
                </Stat>
                <Stat label={t('overview.phone')}>
                  <span className="ltr-iso">{m.contactPhone ?? t('overview.none')}</span>
                </Stat>
              </dl>
            </section>
            <section className={card}>
              <h2 className="text-h3">{t('overview.onboarding')}</h2>
              <ul className="mt-2 space-y-1 text-body-sm">
                {(['products', 'price', 'shopify', 'shipment'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-pill text-caption font-bold ${overview.onboarding[k] ? 'bg-status-delivered text-on-status' : 'border border-line text-text-muted'}`}
                    >
                      {overview.onboarding[k] ? '✓' : ''}
                    </span>
                    {t(`onboarding.${k}`)}
                    <span className="sr-only">
                      {overview.onboarding[k] ? t('overview.done') : t('overview.notDone')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className={card}>
              <h2 className="text-h3">{t('overview.month', { month })}</h2>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <Stat label={t('overview.placed')}>{overview.month.ordersPlaced}</Stat>
                <Stat label={t('overview.delivered')}>{overview.month.ordersDelivered}</Stat>
                <Stat label={t('overview.fees')}>
                  <Amount piastres={overview.month.feesPiastres} />
                </Stat>
                <Stat label={t('overview.owed')}>
                  <Amount piastres={overview.owedPiastres} />
                </Stat>
              </dl>
            </section>
            <section className={card}>
              <h2 className="text-h3">{t('overview.contract')}</h2>
              {contract?.current ? (
                <p className="mt-2 text-body-sm">
                  {t('overview.contractInForce', { label: contract.current.label })}
                </p>
              ) : (
                <p className="mt-2 text-body-sm text-text-muted">{t('overview.noContract')}</p>
              )}
              {contract?.draft && (
                <p className="text-body-sm text-status-needs-action">
                  {t('overview.draftWaiting', { label: contract.draft.label })}
                </p>
              )}
              <Link
                href={`/admin/merchants/${id}?tab=contract`}
                className="mt-2 inline-block font-bold text-link"
              >
                {t('overview.openContract')}
              </Link>
            </section>
          </div>
        )}

        {tab === 'contract' && contract && (
          <ContractTab
            view={contract}
            canManage={canDo(profile, 'merchants', 'manage')}
            today={today}
            selectedVersionId={version ?? null}
          />
        )}

        {tab === 'shopify' && <ShopifyTab merchantId={id} />}

        {tab === 'products' && (
          <section className={card}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('products.skus')}>{overview.products.skus}</Stat>
              <Stat label={t('products.active')}>{overview.products.activeSkus}</Stat>
              <Stat label={t('products.shipments')}>{overview.products.openShipments}</Stat>
              <Stat label={t('products.returns')}>{overview.products.openReturns}</Stat>
            </div>
            <h3 className="mt-4 text-body font-bold">{t('products.stock')}</h3>
            {overview.products.stores.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('products.noStock')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-body-sm">
                {overview.products.stores.map((s) => (
                  <li key={s.darkStoreId} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0">
                      {locale === 'ar' ? s.nameAr : s.nameEn}{' '}
                      <span className="ltr-iso text-text-muted">({s.code})</span>
                    </span>
                    <span className="ltr-iso text-end">
                      {t('products.units', { onHand: s.onHand, reserved: s.reserved })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex flex-wrap gap-3 text-body-sm font-bold">
              <Link className="text-link" href={`/admin/products?merchant=${id}`}>
                {t('products.openProducts')}
              </Link>
              <Link className="text-link" href={`/admin/shipments?merchant=${id}`}>
                {t('products.openShipments')}
              </Link>
              <Link className="text-link" href="/admin/stock">
                {t('products.openStock')}
              </Link>
            </p>
          </section>
        )}

        {tab === 'users' && (
          <section className={card}>
            {overview.users.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('users.none')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {overview.users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-body-sm font-bold">{u.name}</p>
                      <p className="break-all text-caption text-text-muted">
                        {u.email}
                        {u.phone && <span className="ltr-iso"> · {u.phone}</span>}
                      </p>
                    </div>
                    <p className="text-caption">
                      {t(`users.role.${u.merchantRole ?? 'owner'}`)} ·{' '}
                      {u.isActive ? t('active') : t('paused')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-caption text-text-muted">{t('users.hint')}</p>
          </section>
        )}

        {tab === 'profit' && canProfit && <ProfitTab merchantId={id} month={month} />}

        {tab === 'history' && (
          <>
            <RecordHistory entityType="merchant_contract" entityId={id} />
            <RecordHistory entityType="merchant" entityId={id} />
          </>
        )}
      </div>
    </>
  );
}

async function ShopifyTab({ merchantId }: { merchantId: string }) {
  const t = await getTranslations('admin.merchantPage');
  const data = await apiGet<ShopifyOverview>('/admin/shopify').catch(() => null);
  const shop = data?.shops.find((s) => s.merchant.id === merchantId);
  return (
    <section className={card}>
      {shop ? (
        <>
          <p className="break-all text-body font-bold">{shop.shopDomain}</p>
          <p className="text-body-sm text-text-muted">{t(`shopify.status.${shop.status}`)}</p>
          <div className="mt-3">
            <Readiness shop={shop} />
          </div>
        </>
      ) : (
        <p className="text-body-sm text-text-muted">{t('shopify.none')}</p>
      )}
      <Link href="/admin/shopify" className="mt-3 inline-block font-bold text-link">
        {t('shopify.open')}
      </Link>
    </section>
  );
}

async function ProfitTab({ merchantId, month }: { merchantId: string; month: string }) {
  const profit = await apiGet<MerchantProfitDetail>(
    `/finance/merchant-profit/${merchantId}?month=${month}`,
  );
  return (
    <div className="max-w-2xl">
      <ProfitSummaryCard row={profit} month={month} />
    </div>
  );
}
