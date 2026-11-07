'use client';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Empty, Loading, PageHeader, Select, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Msg { id: string; channel: string; to: string; template: string; body: string; status: string; error: string; createdAt: string }

/** Every SMS and WhatsApp message. They wait here until a provider is connected. */
export default function MessagesPage() {
  const t = useT();
  const [status, setStatus] = useState('');
  const list = useLoad<Msg[]>(`/admin/messages${status ? `?status=${status}` : ''}`);
  const r = useRunner(() => list.reload());
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Messages')}
        subtitle={t('Customer messages and sign up codes. Until an SMS or WhatsApp provider is connected they stay queued here')}
        actions={
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('All')}</option>
              <option value="QUEUED">{t('Queued')}</option>
              <option value="SENT">{t('Sent')}</option>
              <option value="FAILED">{t('Failed')}</option>
            </Select>
            <Button tone="secondary" onClick={() => void r.run(async () => { const x = await api<{ sent: number; provider: boolean }>('/admin/jobs/send-messages', { body: {} }); r.setMsg({ ok: x.provider, text: x.provider ? t('{n} sent', { n: x.sent }) : t('No provider connected yet') }); }, 'Done')}>{t('Send now')}</Button>
          </div>
        }
      />
      {r.view}
      <Card>
        {list.data.length === 0 ? <Empty>{t('No messages yet')}</Empty> : (
          <Table head={[t('To'), t('Message'), t('Status'), t('When')]}>
            {list.data.map((m) => (
              <tr key={m.id}>
                <Td><span className="ltr-iso">{m.to}</span><div className="text-caption text-text-muted">{m.channel}</div></Td>
                <Td><span dir="auto" className="block max-w-md text-body-sm">{m.template === 'OTP' ? t('Sign up code (hidden)') : m.body}</span></Td>
                <Td>{m.status === 'SENT' ? <Badge tone="green">{t('Sent')}</Badge> : m.status === 'FAILED' ? <Badge tone="red">{t('Failed')}</Badge> : <Badge tone="amber">{t('Queued')}</Badge>}{m.error && <div className="text-caption text-danger">{m.error}</div>}</Td>
                <Td>{dateTime(m.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
