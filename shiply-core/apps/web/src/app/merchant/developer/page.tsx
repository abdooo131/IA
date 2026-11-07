'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRunner } from '@/components/money';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Key { id: string; name: string; mode: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface Hook { id: string; url: string; mode: string; events: string[]; active: boolean; failures: number; secretEnd: string; createdAt: string }
interface Delivery { id: string; event: string; status: string; attempts: number; responseCode: number | null; responseBody: string; nextAttemptAt: string; sentAt: string | null; createdAt: string }

const EVENTS = ['shipment.created', 'shipment.updated', 'shipment.delivered', 'shipment.failed_attempt', 'shipment.returned', 'shipment.cancelled'];

function Copy({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button tone="secondary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setDone(true)); }}>{done ? t('Copied') : t('Copy')}</Button>
  );
}

function Keys() {
  const t = useT();
  const keys = useLoad<Key[]>('/merchant/developer/keys');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'LIVE' | 'TEST'>('TEST');
  const [fresh, setFresh] = useState<string | null>(null);
  const r = useRunner(() => keys.reload());
  return (
    <Card title={t('API keys')}>
      {r.view}
      {fresh && (
        <div className="mb-4 space-y-2">
          <Alert tone="warning">{t('Copy this key now. We keep only a fingerprint of it and cannot show it again')}</Alert>
          <div className="flex gap-2"><Input readOnly value={fresh} className="ltr-iso font-mono" /><Copy text={fresh} /></div>
        </div>
      )}
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name, for example My website')} />
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'LIVE' | 'TEST')}>
          <option value="TEST">{t('Test (sandbox)')}</option>
          <option value="LIVE">{t('Live')}</option>
        </Select>
        <Button disabled={r.busy || name.trim().length < 2} onClick={() => void r.run(async () => {
          const k = await api<{ key: string }>('/merchant/developer/keys', { body: { name, mode } });
          setFresh(k.key);
          setName('');
        }, 'Key made')}>{t('Make a key')}</Button>
      </div>
      {!keys.data ? <Loading /> : keys.data.length === 0 ? <Empty>{t('No keys yet. Start with a test key: it works in the sandbox only')}</Empty> : (
        <Table head={[t('Name'), t('Mode'), t('Key'), t('Last used'), '']}>
          {keys.data.map((k) => (
            <tr key={k.id} className={k.revokedAt ? 'opacity-50' : ''}>
              <Td>{k.name}<div className="text-caption text-text-muted">{dateTime(k.createdAt)}</div></Td>
              <Td><Badge tone={k.mode === 'LIVE' ? 'green' : 'amber'}>{k.mode === 'LIVE' ? t('Live') : t('Test')}</Badge></Td>
              <Td><span className="ltr-iso font-mono text-caption">{k.prefix}…</span></Td>
              <Td>{k.lastUsedAt ? dateTime(k.lastUsedAt) : t('Never')}</Td>
              <Td>{k.revokedAt ? <Badge>{t('Revoked')}</Badge> : <button type="button" className="text-caption font-bold text-danger" onClick={() => { if (confirm(t('Revoke this key? Calls with it stop working at once'))) void r.call(`/merchant/developer/keys/${k.id}/revoke`, {}, 'Revoked'); }}>{t('Revoke')}</button>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const t = useT();
  const list = useLoad<Delivery[]>(`/merchant/developer/webhooks/${hookId}/deliveries`);
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  if (list.data.length === 0) return <p className="text-caption text-text-muted">{t('Nothing sent yet')}</p>;
  return (
    <div className="space-y-2">
      {r.view}
      <ul className="max-h-72 space-y-1 overflow-y-auto text-caption">
        {list.data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-2 py-1.5">
            <Badge tone={d.status === 'SENT' ? 'green' : d.status === 'FAILED' ? 'red' : 'amber'}>{d.status === 'SENT' ? t('Delivered') : d.status === 'FAILED' ? t('Gave up') : t('Waiting')}</Badge>
            <span className="ltr-iso font-mono">{d.event}</span>
            <span className="text-text-muted">{dateTime(d.createdAt)}</span>
            {d.responseCode !== null && <span className="ltr-iso">HTTP {d.responseCode}</span>}
            {d.status !== 'SENT' && d.attempts > 0 && <span className="truncate text-text-muted">{d.responseBody}</span>}
            {d.status === 'PENDING' && d.attempts > 0 && <span className="text-text-muted">{t('Next try')} {dateTime(d.nextAttemptAt)}</span>}
            {d.status !== 'SENT' && <button type="button" className="font-bold text-link" onClick={() => void r.call(`/merchant/developer/deliveries/${d.id}/retry`, {}, 'Sent again')}>{t('Send again')}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hooks() {
  const t = useT();
  const hooks = useLoad<Hook[]>('/merchant/developer/webhooks');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'LIVE' | 'TEST'>('LIVE');
  const [events, setEvents] = useState<string[]>(['*']);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const r = useRunner(() => hooks.reload());
  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events.filter((x) => x !== '*'), e]);
  return (
    <Card title={t('Webhooks')}>
      <p className="mb-3 text-body-sm text-text-muted">{t('We call your address when a parcel changes. Each call is signed with the secret so you can check it came from us. Failed calls are tried again for about a day.')}</p>
      {r.view}
      {secret && (
        <div className="mb-4 space-y-2">
          <Alert tone="info">{t('Signing secret')}</Alert>
          <div className="flex gap-2"><Input readOnly value={secret.value} className="ltr-iso font-mono" /><Copy text={secret.value} /></div>
        </div>
      )}
      <div className="mb-4 space-y-3 rounded-lg bg-surface-raised p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
          <Field label={t('Address')}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example/shiply/webhook" className="ltr-iso" /></Field>
          <Field label={t('Mode')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'LIVE' | 'TEST')}><option value="LIVE">{t('Live')}</option><option value="TEST">{t('Test (sandbox)')}</option></Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-body-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={events.includes('*')} onChange={() => setEvents(events.includes('*') ? [] : ['*'])} />{t('Every event')}</label>
          {EVENTS.map((e) => <label key={e} className="flex items-center gap-2"><input type="checkbox" checked={events.includes(e)} disabled={events.includes('*')} onChange={() => toggle(e)} /><span className="ltr-iso font-mono text-caption">{e}</span></label>)}
        </div>
        <Button disabled={r.busy || !url || events.length === 0} onClick={() => void r.run(async () => {
          const h = await api<{ id: string; secret: string }>('/merchant/developer/webhooks', { body: { url, mode, events } });
          setSecret({ id: h.id, value: h.secret });
          setUrl('');
        }, 'Saved. Keep the signing secret to check our calls')}>{t('Add webhook')}</Button>
      </div>
      {!hooks.data ? <Loading /> : hooks.data.length === 0 ? <Empty>{t('No webhooks yet')}</Empty> : (
        <div className="space-y-3">
          {hooks.data.map((h) => (
            <div key={h.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ltr-iso break-all font-mono text-body-sm">{h.url}</span>
                <Badge tone={h.mode === 'LIVE' ? 'green' : 'amber'}>{h.mode === 'LIVE' ? t('Live') : t('Test')}</Badge>
                {!h.active && <Badge tone="red">{t('Off')}</Badge>}
                {h.failures > 0 && <Badge tone="amber">{t('{n} failures in a row', { n: h.failures })}</Badge>}
              </div>
              <p className="mt-1 ltr-iso text-caption text-text-muted">{h.events.join(', ')} · whsec_…{h.secretEnd}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-caption font-bold">
                <button type="button" className="text-link" onClick={() => void r.run(async () => {
                  const p = await api<{ ok: boolean; responseCode: number | null; responseBody: string }>(`/merchant/developer/webhooks/${h.id}/ping`, { body: {} });
                  if (!p.ok) throw new Error(`${t('Your server did not answer with 2xx')}: ${p.responseCode ?? ''} ${p.responseBody}`);
                }, 'Your server answered')}>{t('Send a test call')}</button>
                <button type="button" className="text-link" onClick={() => void api<{ secret: string }>(`/merchant/developer/webhooks/${h.id}/secret`).then((s) => setSecret({ id: h.id, value: s.secret }))}>{t('Show secret')}</button>
                <button type="button" className="text-link" onClick={() => void r.run(() => api(`/merchant/developer/webhooks/${h.id}`, { method: 'PUT', body: { url: h.url, mode: h.mode, events: h.events, active: !h.active } }), 'Saved')}>{h.active ? t('Turn off') : t('Turn on')}</button>
                <button type="button" className="text-link" onClick={() => setOpen(open === h.id ? null : h.id)}>{t('Calls')}</button>
                <button type="button" className="text-danger" onClick={() => { if (confirm(t('Delete this webhook?'))) void r.run(() => api(`/merchant/developer/webhooks/${h.id}`, { method: 'DELETE' }), 'Deleted'); }}>{t('Delete')}</button>
              </div>
              {open === h.id && <div className="mt-3"><Deliveries hookId={h.id} /></div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** API keys and webhooks, for merchants who connect their own store or system. */
export default function DeveloperPage() {
  const t = useT();
  return (
    <div className="space-y-5">
      <PageHeader title={t('Developers')} subtitle={t('Connect your website or system to Shiply: create parcels, follow them and hear about every change')} actions={<Link href="/docs/api" className="btn-secondary" target="_blank">{t('API guide')}</Link>} />
      <Keys />
      <Hooks />
    </div>
  );
}
