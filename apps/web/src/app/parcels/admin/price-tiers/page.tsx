'use client';
import { useEffect, useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { Button, Card, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type Tier = { name: string; minParcels: number; discountBp: number };

/** Monthly volume tiers: parcels shipped last month earn this month's discount. */
export default function PriceTiersPage() {
  const t = useT();
  const tiers = useLoad<Tier[]>('/admin/price-tiers');
  const r = useRunner(() => tiers.reload());
  const [rows, setRows] = useState<{ name: string; min: string; pct: string }[]>([]);
  useEffect(() => setRows((tiers.data ?? []).map((x) => ({ name: x.name, min: String(x.minParcels), pct: String(x.discountBp / 100) }))), [tiers.data]);
  if (!tiers.data) return <Loading />;
  const save = () => r.run(() => api('/admin/price-tiers', { method: 'PUT', body: { tiers: rows.filter((x) => x.name).map((x) => ({ name: x.name, minParcels: Number(x.min) || 0, discountBp: Math.round(Number(x.pct) * 100) || 0 })) } }), 'Saved');
  const set = (i: number, k: 'name' | 'min' | 'pct', v: string) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="space-y-5">
      <PageHeader title={t('Price tiers')} subtitle={t('A merchant without an agreed discount gets the tier their parcels last month reached')} actions={<Button onClick={() => void save()}>{t('Save')}</Button>} />
      {r.view}
      <Card>
        <Table head={[t('Name'), t('From parcels a month'), t('Discount %'), '']}>
          {rows.map((x, i) => (
            <tr key={i}>
              <Td><Input value={x.name} onChange={(e) => set(i, 'name', e.target.value)} /></Td>
              <Td><Input inputMode="numeric" className="ltr-iso w-28" value={x.min} onChange={(e) => set(i, 'min', e.target.value)} /></Td>
              <Td><Input inputMode="decimal" className="ltr-iso w-24" value={x.pct} onChange={(e) => set(i, 'pct', e.target.value)} /></Td>
              <Td><Button tone="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t('Remove')}</Button></Td>
            </tr>
          ))}
        </Table>
        <Button tone="secondary" className="mt-3" onClick={() => setRows([...rows, { name: '', min: '', pct: '' }])}>{t('Add tier')}</Button>
      </Card>
    </div>
  );
}
