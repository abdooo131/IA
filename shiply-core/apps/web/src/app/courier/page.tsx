'use client';
import { FAIL_REASON_CODES, FAIL_REASON_LABELS_AR, FAIL_REASONS, egpToPiastres } from '@shiply/shared';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Select, Textarea, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

type Stop = {
  id: string;
  direction: 'FORWARD' | 'RETURN';
  result: string;
  codCollected: number;
  shipment: {
    trackingNumber: string; customerName: string; customerPhone: string; address: string; governorateCode: string;
    codAmount: number; allowOpen: boolean; notes: string; description: string; attempts: number;
    merchant: { name: string; phone: string; pickupAddress: string };
  };
};
type Run = { id: string; code: string; status: string; cashCollected: number; items: Stop[] };

function StopCard({ stop, n, onDone }: { stop: Stop; n: number; onDone: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'deliver' | 'fail'>('idle');
  const [cash, setCash] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = stop.shipment;
  const isReturn = stop.direction === 'RETURN';
  const done = stop.result !== 'PENDING';
  const who = isReturn ? s.merchant.name : s.customerName;
  const phone = isReturn ? s.merchant.phone : s.customerPhone;
  const address = isReturn ? s.merchant.pickupAddress : s.address;

  const send = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/courier/stops/${stop.id}/${path}`, { body });
      onDone();
    } catch (e) {
      setError(t(errorMessage(e)));
      setBusy(false);
    }
  };

  return (
    <Card className={cx(done && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-pill text-body-sm font-extrabold', done ? 'bg-surface-raised text-text-muted' : 'bg-accent text-on-accent')}>{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-h3">{who}</p>
            {isReturn ? <Badge tone="red">{t('Return to merchant')}</Badge> : !done && s.attempts > 0 ? <Badge tone="amber">{t('Attempt {n}', { n: s.attempts + 1 })}</Badge> : null}
          </div>
          <p className="ltr-iso font-mono text-caption text-text-muted">{s.trackingNumber}</p>
          <p className="mt-2 text-body-sm">{address}</p>
          {!isReturn && (s.description || s.notes) && <p className="mt-1 text-caption text-text-muted">{[s.description, s.notes].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:${phone}`} className="btn-secondary min-h-11"><Icon name="support" size={18} />{t('Call')}</a>
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="btn-secondary min-h-11"><Icon name="route" size={18} />{t('Map')}</a>
      </div>
      {!isReturn && (
        <div className="mt-3 flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
          <span className="text-body-sm">{s.codAmount > 0 ? t('Collect') : t('Nothing to collect')}</span>
          {s.codAmount > 0 && <span className="tabular ltr-iso text-number-lg">{egp(s.codAmount)}</span>}
        </div>
      )}
      {!isReturn && s.allowOpen && <p className="mt-1 text-caption text-text-muted">{t('Customer may open the parcel')}</p>}

      {done ? (
        <div className="mt-3">
          <Badge tone={stop.result === 'FAILED' ? 'red' : 'green'}>{stop.result === 'FAILED' ? t('Failed, bring it back to the hub') : stop.result === 'RETURNED' ? t('Returned') : t('Delivered, {amount} collected', { amount: egp(stop.codCollected) })}</Badge>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {error && <Alert>{error}</Alert>}
          {mode === 'idle' && (
            <div className="grid grid-cols-2 gap-2">
              <Button tone="primary" className="min-h-12" onClick={() => { setMode('deliver'); setCash(isReturn ? '0' : String(s.codAmount / 100)); }}>{isReturn ? t('Handed back') : t('Delivered')}</Button>
              <Button tone="secondary" className="min-h-12" onClick={() => setMode('fail')}>{t('Could not')}</Button>
            </div>
          )}
          {mode === 'deliver' && (
            <>
              {!isReturn && <Field label={t('Cash collected (EGP)')} hint={t('Must be the full amount')}><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} className="ltr-iso" /></Field>}
              <Field label={t('Received by')}><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={t('Name of the person')} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>{t('Back')}</Button>
                <Button tone="accent" disabled={busy} onClick={() => {
                  const value = isReturn ? 0 : egpToPiastres(cash || '0');
                  if (value === null) return setError(t('Type the amount in EGP'));
                  void send('deliver', { codCollected: value, recipient });
                }}>{t('Confirm')}</Button>
              </div>
            </>
          )}
          {mode === 'fail' && (
            <>
              <Field label={t('What happened?')}>
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">{t('Choose a reason')}</option>
                  {FAIL_REASON_CODES.map((c) => <option key={c} value={c}>{locale === 'ar' ? FAIL_REASON_LABELS_AR[c] : FAIL_REASONS[c].label}</option>)}
                </Select>
              </Field>
              <Field label={t('Notes')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>{t('Back')}</Button>
                <Button tone="danger" disabled={busy || !reason} onClick={() => void send('fail', { reason, note })}>{t('Record attempt')}</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CourierRunPage() {
  const t = useT();
  const run = useLoad<Run | null>('/courier/run');
  if (run.loading && !run.data) return <Loading />;
  const r = run.data;
  if (!r) return (
    <div className="space-y-4">
      <h1 className="text-h2">{t('My run')}</h1>
      <Empty>{t('You have no run right now. The hub will load one for you.')}</Empty>
    </div>
  );
  const pending = r.items.filter((i) => i.result === 'PENDING').length;
  const sorted = [...r.items].sort((a, b) => Number(a.result !== 'PENDING') - Number(b.result !== 'PENDING'));
  return (
    <>
      <div className="shiply-route mb-4 rounded-xl p-5 text-shiply-cream shadow-md">
        <p className="text-label uppercase text-shiply-lime">{t('Run')} <span className="ltr-iso">{r.code}</span></p>
        <p className="mt-2 text-h2">{r.status === 'LOADING' ? t('The hub is still loading your parcels.') : t('{a} of {b} stops left', { a: pending, b: r.items.length })}</p>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-caption opacity-80">{t('Cash you are carrying')}</p>
            <p className="tabular ltr-iso text-number-lg">{egp(r.cashCollected)}</p>
          </div>
          <div className="h-2 w-32 overflow-hidden rounded-pill bg-white/20">
            <div className="h-full bg-shiply-lime" style={{ width: `${r.items.length ? ((r.items.length - pending) / r.items.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>
      {r.status === 'LOADING' ? <Empty>{t('Wait until the hub marks the run as leaving.')}</Empty> : (
        <div className="space-y-3">
          {sorted.map((i, idx) => <StopCard key={i.id} stop={i} n={idx + 1} onDone={() => void run.reload()} />)}
        </div>
      )}
    </>
  );
}
