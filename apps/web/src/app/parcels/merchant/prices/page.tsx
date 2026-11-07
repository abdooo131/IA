'use client';
import { PriceTable, type PriceList } from '@/parcels/components/PriceTable';
import { Badge, Card, Loading, PageHeader } from '@/parcels/components/ui';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

/** The merchant's own prices: list price less their discount or tier, and any agreed prices. VAT included. */
export default function MerchantPrices() {
  const t = useT();
  const p = useLoad<PriceList>('/merchant/prices');
  if (!p.data) return <Loading />;
  const d = p.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('My prices')}
        subtitle={t(
          'Shipping per parcel, VAT included. The more you ship, the lower your tier price next month.',
        )}
      />
      <Card>
        <p className="text-body-sm">
          {d.ownDiscount
            ? t('Your agreed discount: {pct}%', { pct: d.discountBp / 100 })
            : t('Your tier: {name} ({pct}% off), from {n} parcels last month', {
                name: d.tier ? t(d.tier.name) : '',
                pct: d.discountBp / 100,
                n: d.lastMonthParcels,
              })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {d.tiers.map((x) => (
            <Badge key={x.name} tone={d.tier?.name === x.name ? 'lime' : 'slate'}>
              {t(x.name)}: {x.minParcels}+ · {x.discountBp / 100}%
            </Badge>
          ))}
        </div>
      </Card>
      <Card>
        <PriceTable data={d} />
      </Card>
    </div>
  );
}
