'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/parcels/components/Icon';
import { StatCard } from '@/parcels/components/StatCard';
import { Alert, Button, Card, Empty, Input, Loading, PageHeader, StatusBadge, Table, Td, cx } from '@/parcels/components/ui';
import { egp, shortDate } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';
import { useStatusText } from './text';

interface Parcel {
  id: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  governorateCode: string;
  status: string;
  direction: string;
  codAmount: number;
  promisedDate: string | null;
  merchantRef: string;
}
interface ListResult {
  items: Parcel[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

const CHIPS = ['CREATED', 'PICKED_UP', 'AT_INBOUND', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'];
const MOVING = ['PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED'];

export default function ParcelsPage() {
  const t = useT();
  const statusText = useStatusText();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('q', search);
  params.set('page', String(page));
  const { data, error, loading } = useLoad<ListResult>(`/merchant/shipments?${params}`);

  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const onHold = counts.ON_HOLD ?? 0;
  const moving = MOVING.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const pick = (s: string) => {
    setStatus(s);
    setPage(1);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const printable = (data?.items ?? []).filter((p) => p.status === 'CREATED');
  const allSelected = printable.length > 0 && printable.every((p) => selected.has(p.id));
  const printLabels = () => window.open(`/parcels/labels?ids=${[...selected].join(',')}`, '_blank');

  return (
    <div>
      <PageHeader
        eyebrow={t('Merchant')}
        title={t('Parcels')}
        subtitle={t('Everything you sent with Shiply')}
        actions={
          <>
            <Button tone="secondary" disabled={selected.size === 0} onClick={printLabels}>
              <Icon name="print" size={18} />
              {t('Print labels')}
              {selected.size ? <span className="ltr-iso">({selected.size})</span> : null}
            </Button>
            <Link href="/parcels/merchant/new" className="btn-primary">
              <Icon name="create" size={18} />
              {t('New parcel')}
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" className="text-start" onClick={() => pick('ACTION')}>
          <StatCard label={t('Needs your action')} value={String(onHold)} tone="needs-action" icon="alert" alert={onHold > 0} />
        </button>
        <StatCard label={t('On the way')} value={String(moving)} tone="in-progress" icon="route" />
        <StatCard label={t('Delivered')} value={String(counts.DELIVERED ?? 0)} tone="delivered" icon="delivered" />
        <StatCard label={t('Returned to you')} value={String(counts.RETURNED ?? 0)} tone="returning" icon="returns" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={status === ''} onClick={() => pick('')}>
          {t('All')} <span className="ltr-iso">{total}</span>
        </Chip>
        <Chip active={status === 'ACTION'} onClick={() => pick('ACTION')} warn={onHold > 0}>
          {t('Needs your action')} <span className="ltr-iso">{onHold}</span>
        </Chip>
        {CHIPS.map((s) => (
          <Chip key={s} active={status === s} onClick={() => pick(s)}>
            {statusText(s)} <span className="ltr-iso">{counts[s] ?? 0}</span>
          </Chip>
        ))}
      </div>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <Input placeholder={t('Tracking number, customer name, phone or your reference')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" tone="secondary">
          <Icon name="search" size={18} />
          {t('Search')}
        </Button>
      </form>

      {error && <Alert>{error}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>{t('No parcels here yet.')}</Empty>
        ) : (
          <>
            {/* phones: cards */}
            <ul className="divide-y divide-line md:hidden">
              {data.items.map((p) => (
                <li key={p.id} className="flex gap-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${t('Select')} ${p.trackingNumber}`}
                    className="mt-1 h-5 w-5"
                    disabled={p.status !== 'CREATED'}
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <Link href={`/parcels/merchant/${p.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ltr-iso font-mono text-body-sm font-bold text-link">{p.trackingNumber}</span>
                      <StatusBadge status={p.status} direction={p.direction} />
                    </div>
                    <div className="mt-1 truncate text-body-sm">
                      {p.customerName} · {p.governorateCode}
                    </div>
                    <div className="mt-0.5 text-caption text-text-muted">
                      {t('COD')} <span className="ltr-iso tabular">{egp(p.codAmount)}</span>
                      {p.promisedDate ? (
                        <>
                          {' · '}
                          {t('Promised')} <span className="ltr-iso">{shortDate(p.promisedDate)}</span>
                        </>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {/* wider screens: table */}
            <div className="hidden md:block">
              <Table
                head={[
                  <input
                    key="all"
                    type="checkbox"
                    aria-label={t('Select all new parcels')}
                    checked={allSelected}
                    disabled={printable.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(printable.map((p) => p.id)))}
                  />,
                  t('Tracking'),
                  t('Customer'),
                  t('Gov'),
                  t('Status'),
                  t('COD'),
                  t('Promised'),
                  t('Your ref'),
                ]}
              >
                {data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-raised">
                    <Td>
                      <input type="checkbox" aria-label={`${t('Select')} ${p.trackingNumber}`} disabled={p.status !== 'CREATED'} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </Td>
                    <Td>
                      <Link href={`/parcels/merchant/${p.id}`} className="ltr-iso font-mono font-bold text-link hover:underline">{p.trackingNumber}</Link>
                    </Td>
                    <Td>{p.customerName}</Td>
                    <Td>{p.governorateCode}</Td>
                    <Td><StatusBadge status={p.status} direction={p.direction} /></Td>
                    <Td className="tabular ltr-iso">{egp(p.codAmount)}</Td>
                    <Td className="ltr-iso">{shortDate(p.promisedDate)}</Td>
                    <Td className="text-text-muted">{p.merchantRef}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-body-sm text-text-muted">
              <span>{t('{total} parcels · page {page} of {pages}', { total: data.total, page: data.page, pages })}</span>
              <div className="flex gap-2">
                <Button tone="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('Previous')}</Button>
                <Button tone="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('Next')}</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Chip({ active, warn, onClick, children }: { active: boolean; warn?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-caption font-bold',
        active ? 'bg-primary text-on-primary' : warn ? 'bg-accent text-on-accent' : 'bg-surface text-text ring-1 ring-inset ring-line-strong hover:bg-surface-raised',
      )}
    >
      {children}
    </button>
  );
}
