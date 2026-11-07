'use client';
import { useState } from 'react';
import { Icon } from '@/parcels/components/Icon';
import { ScanBox } from '@/parcels/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { egp, shortDate } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type Pickup = {
  id: string;
  code: string;
  date: string;
  status: string;
  expectedCount: number;
  collected: number;
  notes: string;
  merchant: { name: string; phone: string; pickupAddress: string };
};

export default function CourierPickupsPage() {
  const t = useT();
  const pickups = useLoad<Pickup[]>('/courier/pickups');
  const [error, setError] = useState<string | null>(null);

  const finish = async (p: Pickup) => {
    setError(null);
    try {
      await api(`/courier/pickups/${p.id}/finish`, { body: {} });
      await pickups.reload();
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  return (
    <>
      <h1 className="text-h2">{t('Pickups')}</h1>
      <p className="mb-4 mt-1 text-body-sm text-text-muted">
        {t(
          'At the merchant, scan every parcel label before it goes in your vehicle, then take them to the sorting facility.',
        )}
      </p>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!pickups.data ? (
        <Loading />
      ) : pickups.data.length === 0 ? (
        <Empty>{t('No pickups for you.')}</Empty>
      ) : (
        <div className="space-y-4">
          {pickups.data.map((p) => (
            <Card
              key={p.id}
              title={p.merchant.name}
              actions={
                <Badge tone={p.status === 'ASSIGNED' ? 'amber' : 'green'}>
                  {p.status === 'ASSIGNED' ? t('To collect') : t('Take to the facility')}
                </Badge>
              }
            >
              <p className="flex gap-2 text-body-sm">
                <Icon name="store" size={18} className="text-text-muted" />
                {p.merchant.pickupAddress}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                {shortDate(p.date)} · <span className="ltr-iso">{p.code}</span> ·{' '}
                {t('About {n} parcels', { n: p.expectedCount })}
                {p.notes ? ` · ${p.notes}` : ''}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={`tel:${p.merchant.phone}`} className="btn-secondary min-h-11">
                  <Icon name="support" size={18} />
                  {t('Call')}
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.merchant.pickupAddress)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary min-h-11"
                >
                  <Icon name="route" size={18} />
                  {t('Map')}
                </a>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
                <span className="text-body-sm">{t('Collected')}</span>
                <span className="tabular text-number-lg">{p.collected}</span>
              </div>
              {p.status === 'ASSIGNED' && (
                <div className="mt-3 space-y-3">
                  <ScanBox
                    size="md"
                    label={t('Scan parcel label')}
                    onScan={async (code) => {
                      const r = await api(`/courier/pickups/${p.id}/collect`, { body: { code } });
                      void pickups.reload();
                      return { big: String(p.collected + 1), text: t(r.message) };
                    }}
                  />
                  <Button
                    className="w-full min-h-12"
                    tone="accent"
                    disabled={p.collected === 0}
                    onClick={() => void finish(p)}
                  >
                    {t('Done, leaving the merchant')}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <PackagingToHand />
    </>
  );
}

interface PackOrder {
  id: string;
  code: string;
  payment: string;
  total: number;
  notes: string;
  merchant: { name: string; phone: string; pickupAddress: string };
  lines: { id: string; qty: number; product: { name: string; unit: string } }[];
}

function PackagingStop({ o, onDone }: { o: PackOrder; onDone: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const call = async (path: string, body: unknown, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ message: string }>(path, { body });
      setMsg({ ok: true, text: t(r.message) });
      after?.();
    } catch (e) {
      setMsg({ ok: false, text: t(errorMessage(e)) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={o.merchant.name}
      actions={<Badge tone="blue">{t('Packaging to hand over')}</Badge>}
    >
      <p className="flex gap-2 text-body-sm">
        <Icon name="packaging" size={18} className="text-text-muted" />
        {o.merchant.pickupAddress}
      </p>
      <ul className="mt-2 text-body-sm">
        {o.lines.map((l) => (
          <li key={l.id}>
            <span className="tabular font-bold">{l.qty} ×</span> {l.product.name}{' '}
            <span className="text-caption text-text-muted">{l.product.unit}</span>
          </li>
        ))}
      </ul>
      {o.notes && <p className="mt-1 text-caption text-text-muted">{o.notes}</p>}
      <div className="mt-3 flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
        <span className="text-body-sm">
          {o.payment === 'CASH' ? t('Collect') : t('Paid from their balance')}
        </span>
        {o.payment === 'CASH' && (
          <span className="tabular ltr-iso text-number-lg">{egp(o.total)}</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:${o.merchant.phone}`} className="btn-secondary min-h-11">
          <Icon name="support" size={18} />
          {t('Call')}
        </a>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.merchant.pickupAddress)}`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary min-h-11"
        >
          <Icon name="route" size={18} />
          {t('Map')}
        </a>
      </div>
      {msg && (
        <div className="mt-3">
          <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>
        </div>
      )}
      <Field
        label={t('Code from the merchant')}
        hint={t('Ask for the 4 numbers in their SMS only after they have the parcel')}
      >
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="ltr-iso text-center text-h3 tracking-[0.4em]"
          />
          <Button
            tone="secondary"
            disabled={busy}
            onClick={() => void call(`/courier/packaging/${o.id}/send-code`, {})}
          >
            {t('Send again')}
          </Button>
        </div>
      </Field>
      <Button
        className="mt-3 min-h-12 w-full"
        tone="accent"
        disabled={busy || code.length !== 4}
        onClick={() => void call(`/courier/packaging/${o.id}/deliver`, { code }, onDone)}
      >
        {t('Handed over')}
      </Button>
    </Card>
  );
}

/** Packaging orders this courier carries to merchants. */
function PackagingToHand() {
  const t = useT();
  const list = useLoad<PackOrder[]>('/courier/packaging');
  if (!list.data || list.data.length === 0) return null;
  return (
    <div className="mt-6 space-y-4">
      <h2 className="text-h3">{t('Packaging to hand over')}</h2>
      {list.data.map((o) => (
        <PackagingStop key={o.id} o={o} onDone={() => setTimeout(() => void list.reload(), 1200)} />
      ))}
    </div>
  );
}
