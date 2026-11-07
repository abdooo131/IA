'use client';
import { FAIL_REASON_LABELS_AR } from '@shiplynow/shared/parcels';
import Link from 'next/link';
import { useState } from 'react';
import { MoneyInput, toPiastres, useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Attempt {
  id: string; direction: string; reason: string; reasonLabel: string; note: string; at: string; lat: number | null; lng: number | null; flexPaid: number;
  verdict: string | null; reviewNote: string; reviewedBy: string; reviewedAt: string | null; run: string; hub: string;
  courier: { id: string; name: string; phone: string } | null;
  parcel: { id: string; trackingNumber: string; customerName: string; customerPhone: string; address: string; attempts: number; deliverOn: string | null; merchant: { name: string } };
}

function Check({ a, onDone }: { a: Attempt; onDone: () => void }) {
  const t = useT();
  const [fake, setFake] = useState(false);
  const [note, setNote] = useState('');
  const [penalty, setPenalty] = useState('');
  const r = useRunner(onDone);
  return (
    <div className="space-y-2">
      {r.view}
      {!fake ? (
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={r.busy} onClick={() => void r.call(`/control/attempts/${a.id}/review`, { verdict: 'GENUINE' }, 'Marked as genuine')}>{t('Genuine')}</Button>
          <Button tone="danger" onClick={() => setFake(true)}>{t('Not true')}</Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What did the customer say?')} />
          <MoneyInput value={penalty} onChange={setPenalty} placeholder={t('Penalty, EGP')} />
          <div className="flex gap-2">
            <Button tone="secondary" onClick={() => setFake(false)}>{t('Back')}</Button>
            <Button tone="danger" disabled={r.busy || note.trim().length < 3} onClick={() => void r.run(async () => {
              await api(`/control/attempts/${a.id}/review`, { body: { verdict: 'FAKE', note, penalty: penalty.trim() ? toPiastres(penalty) : 0 } });
            }, 'Ticket opened')}>{t('Open ticket')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** QC calls the customer for every failed attempt and postponement, and confirms or opens a ticket. */
export default function AttemptsPage() {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const list = useLoad<Attempt[]>(`/control/attempts?status=${status}`);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Check failed attempts')}
        subtitle={t('Call the customer: did the courier really come? A false reason opens a quality ticket against the courier')}
        actions={<Select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'done')}><option value="open">{t('To check')}</option><option value="done">{t('Checked')}</option></Select>}
      />
      {!list.data ? <Loading /> : list.data.length === 0 ? <Card><Empty>{status === 'open' ? t('Nothing to check. Every attempt of the last 7 days is checked') : t('Nothing checked in the last 7 days')}</Empty></Card> : (
        <div className="space-y-3">
          {list.data.map((a) => (
            <Card key={a.id}>
              <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.reason === 'POSTPONED' ? 'blue' : a.reason === 'REFUSED' ? 'red' : 'amber'}>{locale === 'ar' ? FAIL_REASON_LABELS_AR[a.reason as keyof typeof FAIL_REASON_LABELS_AR] ?? a.reasonLabel : a.reasonLabel}</Badge>
                    {a.direction === 'RETURN' && <Badge tone="slate">{t('Return to merchant')}</Badge>}
                    {a.flexPaid > 0 && <Badge tone="green">{t('FlexShip paid {amount}', { amount: egp(a.flexPaid) })}</Badge>}
                  </div>
                  <Link href={`/parcels/admin/shipments/${a.parcel.id}`} className="ltr-iso mt-2 block font-bold text-link">{a.parcel.trackingNumber}</Link>
                  <p className="text-body-sm">{a.parcel.customerName} · <a href={`tel:${a.parcel.customerPhone}`} className="ltr-iso font-semibold text-link">{a.parcel.customerPhone}</a></p>
                  <p className="text-caption text-text-muted">{a.parcel.address} · {a.parcel.merchant.name}</p>
                  {a.parcel.deliverOn && <p className="text-caption font-semibold">{t('New day')}: <span className="ltr-iso">{a.parcel.deliverOn}</span></p>}
                </div>
                <div className="text-body-sm">
                  <p className="font-semibold">{a.courier?.name ?? ''}</p>
                  {a.courier?.phone && <a href={`tel:${a.courier.phone}`} className="ltr-iso text-caption text-link">{a.courier.phone}</a>}
                  <p className="text-caption text-text-muted">{dateTime(a.at)} · <span className="ltr-iso">{a.run}</span> · {a.hub}</p>
                  {a.note && <p className="mt-1 text-caption">{a.note}</p>}
                  {a.lat !== null && a.lng !== null ? (
                    <a className="mt-1 inline-block text-caption font-semibold text-link" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`}>{t('Where the courier stood')}</a>
                  ) : <p className="mt-1 text-caption text-text-muted">{t('No location sent')}</p>}
                </div>
                <div>
                  {a.verdict ? (
                    <div className="text-body-sm">
                      <Badge tone={a.verdict === 'GENUINE' ? 'green' : 'red'}>{a.verdict === 'GENUINE' ? t('Genuine') : t('Not true')}</Badge>
                      <p className="mt-1 text-caption text-text-muted">{a.reviewedBy} · {dateTime(a.reviewedAt)}</p>
                      {a.reviewNote && <p className="mt-1 text-caption">{a.reviewNote}</p>}
                    </div>
                  ) : <Check a={a} onDone={() => void list.reload()} />}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-caption text-text-muted">{t('Failed attempts stay here for 7 days.')}</p>
    </div>
  );
}
