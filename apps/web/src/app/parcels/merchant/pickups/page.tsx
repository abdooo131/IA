'use client';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
} from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { dateTime, shortDate, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { Icon } from '@/parcels/components/Icon';
import { useT } from '@/parcels/lib/i18n';

interface Pickup {
  id: string;
  code: string;
  date: string;
  status: 'REQUESTED' | 'ASSIGNED' | 'COLLECTED' | 'RECEIVED' | 'CANCELLED';
  expectedCount: number;
  notes: string;
  collectedAt: string | null;
  receivedAt: string | null;
}

const STATUS: Record<
  Pickup['status'],
  { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' }
> = {
  REQUESTED: { label: 'Requested', tone: 'slate' },
  ASSIGNED: { label: 'Courier assigned', tone: 'blue' },
  COLLECTED: { label: 'Collected', tone: 'amber' },
  RECEIVED: { label: 'At our sorting facility', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};

export default function PickupsPage() {
  const t = useT();
  const { data, error, loading, reload } = useLoad<Pickup[]>('/merchant/pickups');
  const [date, setDate] = useState(todayCairo());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const p = await api<Pickup>('/merchant/pickups', { body: { date, notes } });
      setMsg({
        tone: 'success',
        text: t('Pickup {code} requested for {date} with {n} parcels', {
          code: p.code,
          date: shortDate(p.date),
          n: p.expectedCount,
        }),
      });
      setNotes('');
      await reload();
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: Pickup) => {
    if (!window.confirm(t('Cancel pickup {code}?', { code: p.code }))) return;
    try {
      await api(`/merchant/pickups/${p.id}/cancel`, { body: {} });
      await reload();
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Merchant')}
        title={t('Pickups')}
        subtitle={t(
          'Ask a courier to collect your new parcels. They go to your nearest Shiply sorting facility.',
        )}
      />
      <Card
        title={
          <span className="flex items-center gap-2">
            <Icon name="pickups" size={22} className="text-link" />
            {t('Request a pickup')}
          </span>
        }
      >
        {msg && (
          <div className="mb-4">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
        <form onSubmit={request} className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Field label={t('Day')}>
            <Input
              type="date"
              dir="ltr"
              required
              min={todayCairo()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t('Notes for the courier')}>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('Gate, floor, best time…')}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? t('Requesting…') : t('Request pickup')}
          </Button>
        </form>
        <p className="mt-3 text-caption text-text-muted">
          {t(
            'All parcels you created and we have not collected yet will be picked up. Parcels collected before the daily cutoff are promised for the next working day.',
          )}
        </p>
      </Card>
      <Card title={t('Your pickups')}>
        {error && <Alert>{error}</Alert>}
        {loading && !data ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty>{t('No pickups yet.')}</Empty>
        ) : (
          <Table head={[t('Code'), t('Day'), t('Status'), t('Parcels'), t('Collected'), '']}>
            {data.map((p) => (
              <tr key={p.id}>
                <Td className="ltr-iso font-mono font-bold">{p.code}</Td>
                <Td className="ltr-iso">{shortDate(p.date)}</Td>
                <Td>
                  <Badge tone={STATUS[p.status].tone}>{t(STATUS[p.status].label)}</Badge>
                </Td>
                <Td className="tabular">{p.expectedCount}</Td>
                <Td className="ltr-iso">{dateTime(p.collectedAt)}</Td>
                <Td>
                  {(p.status === 'REQUESTED' || p.status === 'ASSIGNED') && (
                    <Button tone="ghost" onClick={() => void cancel(p)}>
                      {t('Cancel')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
