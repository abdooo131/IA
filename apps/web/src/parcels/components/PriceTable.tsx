'use client';
import { PARCEL_SIZES, SIZE_LABELS } from '@shiplynow/shared/parcels';
import { Badge, Table, Td } from '@/parcels/components/ui';
import { egp } from '@/parcels/lib/format';
import { useT } from '@/parcels/lib/i18n';

export interface PriceList {
  tier: { name: string; discountBp: number } | null;
  lastMonthParcels: number;
  discountBp: number;
  ownDiscount: boolean;
  tiers: { name: string; minParcels: number; discountBp: number }[];
  zones: { code: string; name: string; transitDays: number; prices: Record<string, { list: number; price: number; agreed: boolean }> }[];
}

export function PriceTable({ data }: { data: PriceList }) {
  const t = useT();
  return (
    <Table head={[t('Zone'), ...PARCEL_SIZES.map((s) => t(SIZE_LABELS[s]))]}>
      {data.zones.map((z) => (
        <tr key={z.code}>
          <Td>{t(z.name)}<div className="text-caption text-text-muted">{t('{n} days', { n: z.transitDays })}</div></Td>
          {PARCEL_SIZES.map((s) => {
            const p = z.prices[s]!;
            return (
              <Td key={s}>
                <span className="font-bold">{egp(p.price)}</span>
                {p.agreed ? <div><Badge tone="blue">{t('Agreed')}</Badge></div> : p.price !== p.list && <div className="text-caption text-text-muted line-through">{egp(p.list)}</div>}
              </Td>
            );
          })}
        </tr>
      ))}
    </Table>
  );
}

