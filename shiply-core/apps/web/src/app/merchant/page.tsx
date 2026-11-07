'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Input, Loading, PageHeader, StatusBadge, Table, Td, cx } from '@/components/ui';
import { egp, shortDate, statusLabel } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

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

const CHIPS = ['CREATED', 'PICKED_UP', 'AT_HUB', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'];

export default function ParcelsPage() {
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
  const printLabels = () => window.open(`/labels?ids=${[...selected].join(',')}`, '_blank');

  return (
    <div>
      <PageHeader
        title="Parcels"
        subtitle="Everything you sent with Shiply"
        actions={
          <>
            <Button tone="secondary" disabled={selected.size === 0} onClick={printLabels}>
              Print labels{selected.size ? ` (${selected.size})` : ''}
            </Button>
            <Link href="/merchant/new" className="inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              New parcel
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={status === ''} onClick={() => pick('')}>All {total}</Chip>
        <Chip active={status === 'ACTION'} onClick={() => pick('ACTION')} warn={onHold > 0}>
          Needs your action {onHold}
        </Chip>
        {CHIPS.map((s) => (
          <Chip key={s} active={status === s} onClick={() => pick(s)}>
            {statusLabel(s)} {counts[s] ?? 0}
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
        <Input placeholder="Tracking number, customer name, phone or your reference" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" tone="secondary">Search</Button>
      </form>

      {error && <Alert>{error}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>No parcels here yet.</Empty>
        ) : (
          <>
            {/* phones: cards */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((p) => (
                <li key={p.id} className="flex gap-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.trackingNumber}`}
                    className="mt-1 h-5 w-5"
                    disabled={p.status !== 'CREATED'}
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <Link href={`/merchant/${p.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold">{p.trackingNumber}</span>
                      <StatusBadge status={p.status} direction={p.direction} />
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-700">
                      {p.customerName} · {p.governorateCode}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      COD {egp(p.codAmount)}
                      {p.promisedDate ? ` · Promised ${shortDate(p.promisedDate)}` : ''}
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
                    aria-label="Select all new parcels"
                    checked={allSelected}
                    disabled={printable.length === 0}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(printable.map((p) => p.id)))}
                  />,
                  'Tracking',
                  'Customer',
                  'Gov',
                  'Status',
                  'COD',
                  'Promised',
                  'Your ref',
                ]}
              >
                {data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td>
                      <input type="checkbox" aria-label={`Select ${p.trackingNumber}`} disabled={p.status !== 'CREATED'} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </Td>
                    <Td>
                      <Link href={`/merchant/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.trackingNumber}</Link>
                    </Td>
                    <Td>{p.customerName}</Td>
                    <Td>{p.governorateCode}</Td>
                    <Td><StatusBadge status={p.status} direction={p.direction} /></Td>
                    <Td className="tabular-nums">{egp(p.codAmount)}</Td>
                    <Td>{shortDate(p.promisedDate)}</Td>
                    <Td className="text-slate-500">{p.merchantRef}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>
                {data.total} parcels · page {data.page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button tone="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button tone="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
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
        'rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset',
        active ? 'bg-brand-600 text-white ring-brand-600' : warn ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}
