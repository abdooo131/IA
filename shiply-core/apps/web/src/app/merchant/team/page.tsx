'use client';
import { useState } from 'react';
import { useRunner } from '@/components/money';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Member { id: string; name: string; email: string; phone: string; merchantOwner: boolean; merchantRights: string[]; active: boolean }
const RIGHTS: [string, string][] = [['orders', 'Parcels'], ['pickups', 'Pickups'], ['money', 'Money and invoices'], ['settings', 'Settings']];

/** The owner adds team members and chooses what each one can open. */
export default function TeamPage() {
  const t = useT();
  const list = useLoad<Member[]>('/merchant/team');
  const r = useRunner(() => list.reload());
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', rights: ['orders'] as string[] });
  if (list.error) return <PageHeader title={t('Team')} subtitle={t('Only the account owner can manage the team')} />;
  if (!list.data) return <Loading />;
  const toggle = (rights: string[], x: string) => (rights.includes(x) ? rights.filter((y) => y !== x) : [...rights, x]);
  return (
    <div className="space-y-5">
      <PageHeader title={t('Team')} subtitle={t('Give your staff their own sign in, with only the parts they need')} />
      {r.view}
      <Card title={t('Add a team member')}>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(async () => {
              await api('/merchant/team', { body: f });
              setF({ name: '', email: '', phone: '', password: '', rights: ['orders'] });
            }, 'Team member added');
          }}
        >
          <Field label={t('Name')}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Email')}><Input type="email" required className="ltr-iso" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t('Phone')}><Input className="ltr-iso" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={t('Password')}><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-4">
            {RIGHTS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={f.rights.includes(k)} onChange={() => setF({ ...f, rights: toggle(f.rights, k) })} />{t(label)}</label>
            ))}
          </div>
          <div><Button type="submit">{t('Add')}</Button></div>
        </form>
      </Card>
      <Card>
        <Table head={[t('Name'), t('Email'), t('Can open'), t('Status'), '']}>
          {list.data.map((m) => (
            <tr key={m.id}>
              <Td>{m.name}{m.merchantOwner && <span className="ms-2"><Badge tone="lime">{t('Owner')}</Badge></span>}</Td>
              <Td><span className="ltr-iso">{m.email}</span></Td>
              <Td>{m.merchantOwner ? t('Everything') : RIGHTS.filter(([k]) => m.merchantRights.includes(k)).map(([, l]) => t(l)).join(' · ')}</Td>
              <Td>{m.active ? <Badge tone="green">{t('Active')}</Badge> : <Badge tone="red">{t('Inactive')}</Badge>}</Td>
              <Td>
                {!m.merchantOwner && (
                  <Button tone="ghost" onClick={() => void r.run(() => api(`/merchant/team/${m.id}`, { method: 'PUT', body: { name: m.name, email: m.email, phone: m.phone, rights: m.merchantRights, active: !m.active } }), 'Saved')}>
                    {m.active ? t('Deactivate') : t('Activate')}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
