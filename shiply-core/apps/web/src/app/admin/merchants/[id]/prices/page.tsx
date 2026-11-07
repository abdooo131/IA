'use client';
import { PARCEL_SIZES, SIZE_LABELS } from '@shiply/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRunner } from '@/components/money';
import { Button, Card, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { PriceList } from '@/components/PriceTable';

/** Prices agreed with one merchant: an empty cell keeps the list price with their discount or tier. */
export default function MerchantPricesAdmin() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const list = useLoad<PriceList>(`/admin/merchants/${id}/prices`);
  const r = useRunner(() => list.reload());
  const [cells, setCells] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!list.data) return;
    const c: Record<string, string> = {};
    for (const z of list.data.zones) for (const s of PARCEL_SIZES) if (z.prices[s]!.agreed) c[`${z.code}:${s}`] = String(z.prices[s]!.price / 100);
    setCells(c);
  }, [list.data]);
  if (!list.data) return <Loading />;
  const save = () =>
    r.run(() =>
      api(`/admin/merchants/${id}/prices`, {
        method: 'PUT',
        body: { prices: list.data!.zones.flatMap((z) => PARCEL_SIZES.map((s) => ({ zoneCode: z.code, size: s, price: cells[`${z.code}:${s}`] ? Math.round(Number(cells[`${z.code}:${s}`]) * 100) : null }))) },
      }),
      'Saved',
    );
  return (
    <div className="space-y-5">
      <Link href="/admin/merchants" className="text-body-sm font-bold text-link">← {t('Merchants')}</Link>
      <PageHeader title={t('Agreed prices')} subtitle={t('Fill a cell to agree a price for that zone and size, VAT included. Empty cells use the list price with their discount or tier')} actions={<Button onClick={() => void save()}>{t('Save')}</Button>} />
      {r.view}
      <Card>
        <Table head={[t('Zone'), ...PARCEL_SIZES.map((s) => t(SIZE_LABELS[s]))]}>
          {list.data.zones.map((z) => (
            <tr key={z.code}>
              <Td>{t(z.name)}</Td>
              {PARCEL_SIZES.map((s) => (
                <Td key={s}>
                  <Input inputMode="decimal" placeholder={String(z.prices[s]!.list / 100)} className="ltr-iso w-24" value={cells[`${z.code}:${s}`] ?? ''} onChange={(e) => setCells({ ...cells, [`${z.code}:${s}`]: e.target.value })} />
                  <div className="text-caption text-text-muted">{t('List')} {egp(z.prices[s]!.list)}</div>
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
