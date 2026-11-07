'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SHIPMENT_STATUSES, STATUS_LABELS, STATUS_LABELS_AR } from '@shiply/shared';
import { Alert, Button, Card, Empty, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Row {
  id: string;
  trackingNumber: string;
  merchant: { name: string };
  customerName: string;
  governorateCode: string;
  status: string;
  direction: string;
  codAmount: number;
  promisedDate: string | null;
  createdAt: string;
}

function ShipmentsList() {
  const t = useT();
  const locale = useLocale();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const qs = params.toString();
  const { data, error, loading } = useLoad<{ items: Row[]; total: number; page: number; pageSize: number }>(`/admin/shipments${qs ? `?${qs}` : ''}`);
  const { data: merchants } = useLoad<{ id: string; name: string }[]>('/admin/merchants');

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  };

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('Admin')} title={t('Parcels')} subtitle={data ? t('{count} found', { count: data.total }) : undefined} />
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: q.trim() || null });
          }}
        >
          <Input className="lg:col-span-2" placeholder={t('Tracking number, name, phone or reference')} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={params.get('status') ?? ''} onChange={(e) => set({ status: e.target.value || null, late: null })}>
            <option value="">{t('All statuses')}</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{locale === 'ar' ? STATUS_LABELS_AR[s] : STATUS_LABELS[s]}</option>
            ))}
          </Select>
          <Select value={params.get('merchantId') ?? ''} onChange={(e) => set({ merchantId: e.target.value || null })}>
            <option value="">{t('All merchants')}</option>
            {merchants?.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm">
              <input type="checkbox" checked={params.get('late') === '1'} onChange={(e) => set({ late: e.target.checked ? '1' : null, status: null })} />
              {t('Late only')}
            </label>
            <Button type="submit" className="ms-auto">{t('Search')}</Button>
          </div>
        </form>
      </Card>
      {error && <Alert>{error}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>{t('No parcels match.')}</Empty>
        ) : (
          <>
            <Table head={[t('Tracking'), t('Merchant'), t('Customer'), t('Gov.'), t('Status'), t('COD'), t('Promised'), t('Created')]}>
              {data.items.map((s) => (
                <tr key={s.id} className="hover:bg-surface-raised">
                  <Td>
                    <Link href={`/admin/shipments/${s.id}`} className="ltr-iso font-bold text-link">{s.trackingNumber}</Link>
                  </Td>
                  <Td>{s.merchant.name}</Td>
                  <Td>{s.customerName}</Td>
                  <Td>{s.governorateCode}</Td>
                  <Td><StatusBadge status={s.status} direction={s.direction} /></Td>
                  <Td className="tabular ltr-iso">{egp(s.codAmount)}</Td>
                  <Td>{shortDate(s.promisedDate)}</Td>
                  <Td className="text-text-muted">{dateTime(s.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-body-sm">
              <span className="text-text-muted">{t('Page {page} of {pages}', { page, pages })}</span>
              <div className="flex gap-2">
                <Button tone="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>{t('Previous')}</Button>
                <Button tone="secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>{t('Next')}</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShipmentsList />
    </Suspense>
  );
}
