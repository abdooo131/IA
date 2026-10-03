'use client';

import { PRICING_ZONES } from '@shiply/shared';
import { Card, ErrorBox, Money, Spinner, SIZE_LABELS, useApp, useAsync } from '@shiply/ui';

interface Pricing {
  zones: { pickupZone: string; destZone: string; basePricePiastres: number }[];
  sizes: { size: keyof (typeof SIZE_LABELS)['en']; addPiastres: number }[];
  tiers: { tier: string; multiplierBp: number }[];
  overrides: { id: string; pickupZone: string; destZone: string; size: string; orderType: string; tier: string; pricePiastres: number }[];
}

/** Read only view of the pricing tables in Phase 1; editing arrives with the full admin panel (Phase 7). */
export default function PricingPage() {
  const { api, t, lang } = useApp();
  const { data, error, loading } = useAsync(() => api.get<Pricing>('/admin/pricing'), []);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const price = (a: string, b: string) => data.zones.find((z) => z.pickupZone === a && z.destZone === b)?.basePricePiastres;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t.pricing}</h1>
      <Card title={t.zonePrices}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="p-2" />
                {PRICING_ZONES.map((z) => (
                  <th key={z} className="p-2 text-start font-medium text-slate-600">{z}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRICING_ZONES.map((a) => (
                <tr key={a} className="border-t border-slate-100">
                  <th className="p-2 text-start font-medium text-slate-600">{a}</th>
                  {PRICING_ZONES.map((b) => {
                    const p = price(a, b);
                    return <td key={b} className="p-2">{p === undefined ? '-' : <Money value={p} />}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card title={t.sizeAdjustments}>
          <ul className="space-y-1 text-sm">
            {data.sizes.map((s) => (
              <li key={s.size} className="flex justify-between">
                <span>{SIZE_LABELS[lang][s.size]}</span>
                <span>+ <Money value={s.addPiastres} /></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t.tierAdjustments}>
          <ul className="space-y-1 text-sm">
            {data.tiers.map((x) => (
              <li key={x.tier} className="flex justify-between">
                <span>{x.tier}</span>
                <span className="tabular-nums">{(x.multiplierBp / 100).toFixed(2)}%</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
