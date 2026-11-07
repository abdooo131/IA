'use client';
import { egpToPiastres, FAIL_REASON_LABELS_AR, FAIL_REASONS, type FailReason } from '@shiply/shared';
import Link from 'next/link';
import { use, useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { StatCard } from '@/components/StatCard';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

type Item = { id: string; direction: string; result: string; failReason: string | null; codCollected: number; backAtHub: boolean; shipment: { trackingNumber: string; customerName: string; address: string; codAmount: number; status: string } };
type Run = { id: string; code: string; status: string; cashExpected: number; cashReceived: number | null; items: Item[] };

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hub = useHub();
  const t = useT();
  const locale = useLocale();
  const run = useLoad<Run>(`/hubs/${hub.id}/runs/${id}`);
  const [cash, setCash] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'warning'; text: string } | null>(null);

  if (!run.data) return run.error ? <Alert>{run.error}</Alert> : <Loading />;
  const r = run.data;
  const collected = r.items.reduce((n, i) => n + i.codCollected, 0);
  const notBack = r.items.filter((i) => i.result === 'PENDING' || (i.result === 'FAILED' && !i.backAtHub));
  const reason = (code: string) => (code === 'NOT_ATTEMPTED' ? t('Not attempted') : (locale === 'ar' ? FAIL_REASON_LABELS_AR[code as FailReason] : FAIL_REASONS[code as FailReason]?.label) ?? code);
  const RESULT: Record<string, { text: string; tone: 'slate' | 'green' | 'red' | 'amber' }> = {
    PENDING: { text: t('Not done yet'), tone: 'slate' },
    DELIVERED: { text: t('Delivered'), tone: 'green' },
    RETURNED: { text: t('Returned to merchant'), tone: 'green' },
    FAILED: { text: t('Failed'), tone: 'red' },
  };

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await run.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: t(errorMessage(e)) });
    }
  };

  const close = () =>
    act(async () => {
      const value = egpToPiastres(cash || '0');
      if (value === null) throw new Error(t('Type the cash amount in EGP, for example 1250 or 1250.50'));
      const res = await api(`/hubs/${hub.id}/runs/${id}/close`, { body: { cashReceived: value } });
      setMsg(res.difference === 0 ? { tone: 'success', text: t('Run closed. Cash matches.') } : { tone: 'warning', text: t('Run closed. Cash difference {amount} recorded against the courier.', { amount: egp(res.difference) }) });
    });

  const statusText = r.status === 'LOADING' ? t('Loading') : r.status === 'OUT' ? t('On the road') : t('Closed');

  return (
    <>
      <PageHeader
        eyebrow={t('Courier runs')}
        title={`${t('Run')} ${r.code}`}
        subtitle={<Link href="/hub/runs" className="font-bold text-link">{t('All runs')}</Link>}
        actions={<Badge tone={r.status === 'LOADING' ? 'amber' : r.status === 'OUT' ? 'blue' : 'green'}>{statusText}</Badge>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('Parcels')} value={String(r.items.length)} icon="orders" />
        <StatCard label={t('Done')} value={String(r.items.filter((i) => i.result === 'DELIVERED' || i.result === 'RETURNED').length)} icon="delivered" tone="delivered" />
        <StatCard label={t('Failed')} value={String(r.items.filter((i) => i.result === 'FAILED').length)} icon="alert" tone="needs-action" />
        <StatCard label={t('Cash the courier should have')} value={egp(collected)} icon="cash" tone="primary" />
      </div>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      {r.status === 'LOADING' && (
        <Card title={t('Load parcels')} actions={<Button tone="accent" disabled={r.items.length === 0} onClick={() => void act(() => api(`/hubs/${hub.id}/runs/${id}/start`, { body: {} }))}>{t('Courier is leaving now')}</Button>}>
          <ScanBox
            label={t('Scan parcels ready for delivery or return')}
            onScan={async (code) => {
              const res = await api(`/hubs/${hub.id}/runs/${id}/add`, { body: { code } });
              void run.reload();
              return res.direction === 'RETURN' ? { big: t('RETURN'), tone: 'return' as const, text: t('Added as a return to merchant') } : { big: String(r.items.length + 1), text: t('Added for delivery') };
            }}
          />
        </Card>
      )}

      {r.status === 'OUT' && (
        <Card title={t('End of day')}>
          <div className="grid gap-6 md:grid-cols-2">
            <ol className="list-decimal space-y-2 ps-5 text-body-sm">
              <li>{t('Scan every failed or undelivered parcel back in on the Receive page.')}</li>
              <li>{t('Count the cash and type what the courier handed over.')}</li>
              {notBack.length > 0 && <li className="list-none"><Alert tone="warning">{t('Still with the courier')}: <span className="ltr-iso font-bold">{notBack.map((i) => i.shipment.trackingNumber).join(', ')}</span></Alert></li>}
            </ol>
            <div className="space-y-3">
              <div className="rounded-xl bg-surface-raised p-4">
                <p className="text-caption text-text-muted">{t('Cash the courier should have')}</p>
                <p className="tabular ltr-iso text-number-lg">{egp(collected)}</p>
              </div>
              <Field label={t('Cash received (EGP)')}><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" className="ltr-iso" /></Field>
              <Button className="w-full min-h-12" disabled={notBack.length > 0} onClick={() => void close()}>{t('Close run')}</Button>
            </div>
          </div>
        </Card>
      )}

      {r.status === 'CLOSED' && (
        <Card title={t('Closed')}>
          <p className="text-body-sm">
            {t('Expected {a}, received {b}.', { a: egp(r.cashExpected), b: egp(r.cashReceived ?? 0) })}
            {(r.cashReceived ?? 0) !== r.cashExpected && <strong className="text-danger"> {t('Difference')} {egp((r.cashReceived ?? 0) - r.cashExpected)}.</strong>}
          </p>
        </Card>
      )}

      <Card title={`${t('Parcels')} (${r.items.length})`} className="mt-4">
        <Table head={[t('Parcel'), t('Type'), t('Customer'), t('COD'), t('Result'), t('Collected'), '']}>
          {r.items.map((i) => (
            <tr key={i.id}>
              <Td><span className="ltr-iso font-mono">{i.shipment.trackingNumber}</span></Td>
              <Td>{i.direction === 'RETURN' ? <Badge tone="red">{t('Return')}</Badge> : t('Delivery')}</Td>
              <Td>{i.shipment.customerName}</Td>
              <Td className="tabular">{egp(i.shipment.codAmount)}</Td>
              <Td>
                <Badge tone={RESULT[i.result]?.tone ?? 'slate'}>{RESULT[i.result]?.text ?? i.result}</Badge>
                {i.failReason && <span className="ms-1 text-caption text-text-muted">{reason(i.failReason)}</span>}
                {i.result === 'FAILED' && (i.backAtHub ? <span className="ms-1 text-caption text-status-delivered">{t('back in hub')}</span> : <span className="ms-1 text-caption text-status-needs-action">{t('not back yet')}</span>)}
              </Td>
              <Td className="tabular">{egp(i.codCollected)}</Td>
              <Td>{r.status === 'LOADING' && <Button tone="ghost" onClick={() => void act(() => api(`/hubs/${hub.id}/runs/${id}/remove`, { body: { code: i.shipment.trackingNumber } }))}>{t('Remove')}</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
