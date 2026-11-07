'use client';
import {
  FAIL_REASON_CODES,
  FAIL_REASON_LABELS_AR,
  FAIL_REASONS,
  addDays,
  egpToPiastres,
} from '@shiplynow/shared/parcels';
import { useEffect, useState } from 'react';
import { Icon } from '@/parcels/components/Icon';
import { PhotoButton, photoBody } from '@/parcels/components/PhotoButton';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  Select,
  Textarea,
  cx,
} from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { here, queued, savedRun, saveRun, sendStop, useQueue } from '@/parcels/lib/courier-sync';
import { dateTime, egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

type Stop = {
  id: string;
  shipmentId: string;
  direction: 'FORWARD' | 'RETURN';
  result: string;
  codCollected: number;
  flexPaid: number;
  needsCode: boolean;
  shipment: {
    trackingNumber: string;
    customerName: string;
    customerPhone: string;
    address: string;
    governorateCode: string;
    codAmount: number;
    allowOpen: boolean;
    notes: string;
    description: string;
    attempts: number;
    kind: string;
    customerNote: string;
    deliverOn: string | null;
    shippingFee: number;
    merchant: { name: string; phone: string; pickupAddress: string; flexShip: boolean };
  };
};
type Run = {
  id: string;
  code: string;
  status: string;
  cashCollected: number;
  codeRequired: boolean;
  items: Stop[];
};

function StopCard({
  stop,
  n,
  onDone,
}: {
  stop: Stop;
  n: number;
  onDone: (queued: boolean) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'deliver' | 'fail' | 'collect'>('idle');
  const [cash, setCash] = useState('');
  const [recipient, setRecipient] = useState('');
  const [code, setCode] = useState('');
  const [oldItem, setOldItem] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState('');
  const [flexPaid, setFlexPaid] = useState<'' | 'yes' | 'no'>('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = stop.shipment;
  const isReturn = stop.direction === 'RETURN';
  const collect = s.kind === 'CUSTOMER_RETURN' && !isReturn;
  const done = stop.result !== 'PENDING';
  const toMerchant = isReturn && s.kind !== 'EXCHANGE_RETURN';
  const who = toMerchant ? s.merchant.name : s.customerName;
  const phone = toMerchant ? s.merchant.phone : s.customerPhone;
  const address = toMerchant ? s.merchant.pickupAddress : s.address;
  const flex = s.merchant.flexShip && !isReturn && !collect && reason === 'REFUSED';
  const today = todayCairo();

  const send = async (action: string, body: Record<string, unknown>, result: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendStop(stop.id, action, { ...body, ...here() }, result);
      onDone(r === 'queued');
    } catch (e) {
      setError(t(errorMessage(e)));
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    try {
      const r = await api<{ message: string }>(`/courier/stops/${stop.id}/send-code`, { body: {} });
      setInfo(t(r.message));
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  const doneLabel =
    stop.result === 'QUEUED'
      ? t('Saved on the phone, sends when there is signal')
      : stop.result === 'FAILED'
        ? s.kind === 'CUSTOMER_RETURN' && isReturn
          ? t('Return collected, bring it to the hub')
          : stop.flexPaid
            ? t('Refused, shipping paid {amount}. Bring it back', { amount: egp(stop.flexPaid) })
            : t('Failed, bring it back to the hub')
        : stop.result === 'RETURNED'
          ? t('Returned')
          : t('Delivered, {amount} collected', { amount: egp(stop.codCollected) });

  return (
    <Card className={cx(done && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'grid h-9 w-9 shrink-0 place-items-center rounded-pill text-body-sm font-extrabold',
            done ? 'bg-surface-raised text-text-muted' : 'bg-accent text-on-accent',
          )}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-h3">{who}</p>
            {collect ? (
              <Badge tone="blue">{t('Collect a return from the customer')}</Badge>
            ) : toMerchant ? (
              <Badge tone="red">{t('Return to merchant')}</Badge>
            ) : !done && s.attempts > 0 ? (
              <Badge tone="amber">{t('Attempt {n}', { n: s.attempts + 1 })}</Badge>
            ) : null}
            {s.kind === 'EXCHANGE' && (
              <Badge tone="blue">{t('Exchange: collect the old item')}</Badge>
            )}
            {s.merchant.flexShip && !isReturn && !collect && <Badge tone="slate">FlexShip</Badge>}
          </div>
          <p className="ltr-iso font-mono text-caption text-text-muted">{s.trackingNumber}</p>
          <p className="mt-2 text-body-sm">{address}</p>
          {!isReturn && (s.description || s.notes) && (
            <p className="mt-1 text-caption text-text-muted">
              {[s.description, s.notes].filter(Boolean).join(' · ')}
            </p>
          )}
          {!isReturn && s.customerNote && (
            <p className="mt-1 text-caption font-bold text-link">
              {t('Customer says')}: {s.customerNote}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:${phone}`} className="btn-secondary min-h-11">
          <Icon name="support" size={18} />
          {t('Call')}
        </a>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary min-h-11"
        >
          <Icon name="route" size={18} />
          {t('Map')}
        </a>
      </div>
      {!isReturn && !collect && (
        <div className="mt-3 flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
          <span className="text-body-sm">
            {s.codAmount > 0 ? t('Collect') : t('Nothing to collect')}
          </span>
          {s.codAmount > 0 && (
            <span className="tabular ltr-iso text-number-lg">{egp(s.codAmount)}</span>
          )}
        </div>
      )}
      {!isReturn && s.allowOpen && (
        <p className="mt-1 text-caption text-text-muted">{t('Customer may open the parcel')}</p>
      )}

      {done ? (
        <div className="mt-3">
          <Badge
            tone={
              stop.result === 'QUEUED'
                ? 'amber'
                : stop.result === 'FAILED' && !(s.kind === 'CUSTOMER_RETURN' && isReturn)
                  ? 'red'
                  : 'green'
            }
          >
            {doneLabel}
          </Badge>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {error && <Alert>{error}</Alert>}
          {info && <Alert tone="success">{info}</Alert>}
          {mode === 'idle' && (
            <div className="grid grid-cols-2 gap-2">
              {collect ? (
                <Button tone="primary" className="min-h-12" onClick={() => setMode('collect')}>
                  {t('Collected')}
                </Button>
              ) : (
                <Button
                  tone="primary"
                  className="min-h-12"
                  onClick={() => {
                    setMode('deliver');
                    setCash(isReturn ? '0' : String(s.codAmount / 100));
                  }}
                >
                  {isReturn ? t('Handed back') : t('Delivered')}
                </Button>
              )}
              <Button tone="secondary" className="min-h-12" onClick={() => setMode('fail')}>
                {t('Could not')}
              </Button>
            </div>
          )}

          {mode === 'deliver' && (
            <>
              {!isReturn && (
                <Field label={t('Cash collected (EGP)')} hint={t('Must be the full amount')}>
                  <Input
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    className="ltr-iso"
                  />
                </Field>
              )}
              {stop.needsCode && (
                <Field
                  label={isReturn ? t('Code from the merchant') : t('Code from the customer')}
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
                    <Button tone="secondary" onClick={() => void resend()}>
                      {t('Send again')}
                    </Button>
                  </div>
                </Field>
              )}
              <Field label={t('Received by')}>
                <Input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={t('Name of the person')}
                />
              </Field>
              {s.kind === 'EXCHANGE' && (
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={oldItem}
                    onChange={(e) => setOldItem(e.target.checked)}
                  />
                  {t('I took the old item from the customer')}
                </label>
              )}
              <Field label={t('Photo')} hint={t('Optional proof of the hand over')}>
                <PhotoButton value={photo} onChange={setPhoto} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>
                  {t('Back')}
                </Button>
                <Button
                  tone="accent"
                  disabled={busy || (stop.needsCode && code.length !== 4)}
                  onClick={() => {
                    const value = isReturn ? 0 : egpToPiastres(cash || '0');
                    if (value === null) return setError(t('Type the amount in EGP'));
                    void send(
                      'deliver',
                      {
                        codCollected: value,
                        recipient,
                        ...(stop.needsCode ? { code } : {}),
                        ...(photo ? { photo: photoBody(photo) } : {}),
                        ...(s.kind === 'EXCHANGE' ? { exchangeCollected: oldItem } : {}),
                      },
                      isReturn ? 'RETURNED' : 'DELIVERED',
                    );
                  }}
                >
                  {t('Confirm')}
                </Button>
              </div>
            </>
          )}

          {mode === 'collect' && (
            <>
              <p className="text-body-sm">
                {t('Take a photo of the item in front of the customer, then bring it to the hub.')}
              </p>
              <PhotoButton value={photo} onChange={setPhoto} label={t('Photo of the return')} />
              <Field label={t('Notes')}>
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('Condition of the item')}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>
                  {t('Back')}
                </Button>
                <Button
                  tone="accent"
                  disabled={busy || !photo}
                  onClick={() =>
                    photo &&
                    void send('collect-return', { photo: photoBody(photo), note }, 'FAILED')
                  }
                >
                  {t('Confirm')}
                </Button>
              </div>
            </>
          )}

          {mode === 'fail' && (
            <>
              <Field label={t('What happened?')}>
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">{t('Choose a reason')}</option>
                  {FAIL_REASON_CODES.filter((c) => !(collect && c === 'POSTPONED')).map((c) => (
                    <option key={c} value={c}>
                      {locale === 'ar' ? FAIL_REASON_LABELS_AR[c] : FAIL_REASONS[c].label}
                    </option>
                  ))}
                </Select>
              </Field>
              {reason === 'POSTPONED' && !isReturn && (
                <Field label={t('Which day did the customer ask for?')}>
                  <Input
                    type="date"
                    min={addDays(today, 1)}
                    max={addDays(today, 14)}
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    className="ltr-iso"
                  />
                </Field>
              )}
              {flex && (
                <Field
                  label={t('FlexShip: did the customer pay the shipping of {amount}?', {
                    amount: egp(s.shippingFee),
                  })}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      tone={flexPaid === 'yes' ? 'primary' : 'secondary'}
                      onClick={() => setFlexPaid('yes')}
                    >
                      {t('Yes, paid')}
                    </Button>
                    <Button
                      tone={flexPaid === 'no' ? 'primary' : 'secondary'}
                      onClick={() => setFlexPaid('no')}
                    >
                      {t('No, refused to pay')}
                    </Button>
                  </div>
                </Field>
              )}
              <Field label={t('Notes')}>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <p className="text-caption text-text-muted">
                {t('Quality calls the customer to check every failed attempt.')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="secondary" onClick={() => setMode('idle')}>
                  {t('Back')}
                </Button>
                <Button
                  tone="danger"
                  disabled={
                    busy ||
                    !reason ||
                    (reason === 'POSTPONED' && !isReturn && !day) ||
                    (flex && !flexPaid)
                  }
                  onClick={() =>
                    void send(
                      'fail',
                      {
                        reason,
                        note,
                        ...(reason === 'POSTPONED' && day ? { deliverOn: day } : {}),
                        ...(flex ? { flexPaid: flexPaid === 'yes' } : {}),
                      },
                      'FAILED',
                    )
                  }
                >
                  {t('Record attempt')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function VehicleProblem() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const report = async (reason: 'BREAKDOWN' | 'VEHICLE_FULL') => {
    try {
      const r = await api<{ message: string }>('/courier/vehicle-problem', {
        body: { reason, note },
      });
      setMsg({ ok: true, text: t(r.message) });
      setOpen(false);
    } catch (e) {
      setMsg({ ok: false, text: t(errorMessage(e)) });
    }
  };
  return (
    <div className="mt-6">
      {msg && (
        <div className="mb-2">
          <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>
        </div>
      )}
      {!open ? (
        <button
          type="button"
          className="text-body-sm font-semibold text-link underline"
          onClick={() => setOpen(true)}
        >
          {t('Problem with your vehicle?')}
        </button>
      ) : (
        <Card title={t('Problem with your vehicle?')}>
          <Field label={t('Notes')}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Where are you, what happened')}
            />
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button tone="danger" onClick={() => void report('BREAKDOWN')}>
              {t('It broke down')}
            </Button>
            <Button tone="secondary" onClick={() => void report('VEHICLE_FULL')}>
              {t('It is full')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function CourierRunPage() {
  const t = useT();
  const run = useLoad<Run | null>('/courier/run');
  const [saved, setSaved] = useState<{ run: Run | null; at: number } | null>(null);
  const [tick, setTick] = useState(0);
  const queue = useQueue(() => void run.reload());

  useEffect(() => {
    if (!run.loading && !run.error) saveRun(run.data);
  }, [run.data, run.error, run.loading]);
  useEffect(() => {
    if (run.error) setSaved(savedRun<Run | null>());
  }, [run.error]);

  const offline = !!run.error && !!saved;
  const base = offline ? saved!.run : run.data;
  if (run.loading && !base) return <Loading />;
  if (!base)
    return (
      <div className="space-y-4">
        <h1 className="text-h2">{t('My run')}</h1>
        {run.error ? (
          <Alert>{t(run.error)}</Alert>
        ) : (
          <Empty>{t('You have no run right now. The hub will load one for you.')}</Empty>
        )}
        <VehicleProblem />
      </div>
    );
  // Results still on the phone show as done until they reach the hub.
  void tick;
  const waiting = new Map(queued().map((q) => [q.itemId, q]));
  const r: Run = {
    ...base,
    items: base.items.map((i) =>
      waiting.has(i.id) && i.result === 'PENDING' ? { ...i, result: 'QUEUED' } : i,
    ),
  };
  const pending = r.items.filter((i) => i.result === 'PENDING').length;
  const sorted = [...r.items].sort(
    (a, b) => Number(a.result !== 'PENDING') - Number(b.result !== 'PENDING'),
  );
  return (
    <>
      {offline && (
        <div className="mb-3">
          <Alert>
            {t(
              'No signal. Showing your run as saved at {time}. Results are kept on the phone and sent later.',
              { time: dateTime(new Date(saved!.at)) },
            )}
          </Alert>
        </div>
      )}
      {queue.list.length > 0 && (
        <div className="mb-3">
          <Alert tone="info">
            {t('{n} results wait on the phone and will be sent when there is signal', {
              n: queue.list.length,
            })}
          </Alert>
        </div>
      )}
      {queue.rejected.map((m, i) => (
        <div key={i} className="mb-3">
          <Alert>
            {t('A saved result was refused')}: {t(m)}
          </Alert>
        </div>
      ))}
      <div className="shiply-route mb-4 rounded-xl p-5 text-shiply-cream shadow-md">
        <p className="text-label uppercase text-shiply-lime">
          {t('Run')} <span className="ltr-iso">{r.code}</span>
        </p>
        <p className="mt-2 text-h2">
          {r.status === 'LOADING'
            ? t('The hub is still loading your parcels.')
            : t('{a} of {b} stops left', { a: pending, b: r.items.length })}
        </p>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-caption opacity-80">{t('Cash you are carrying')}</p>
            <p className="tabular ltr-iso text-number-lg">{egp(r.cashCollected)}</p>
          </div>
          <div className="h-2 w-32 overflow-hidden rounded-pill bg-white/20">
            <div
              className="h-full bg-shiply-lime"
              style={{
                width: `${r.items.length ? ((r.items.length - pending) / r.items.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>
      {r.status === 'LOADING' ? (
        <Empty>{t('Wait until the hub marks the run as leaving.')}</Empty>
      ) : (
        <div className="space-y-3">
          {sorted.map((i, idx) => (
            <StopCard
              key={i.id}
              stop={i}
              n={idx + 1}
              onDone={(q) => (q ? setTick((x) => x + 1) : void run.reload())}
            />
          ))}
        </div>
      )}
      <VehicleProblem />
    </>
  );
}
