'use client';
import { useState } from 'react';
import { ROLES, TEAM_LABELS, TEAM_LABELS_AR, type Role, type Team } from '@shiply/shared';
import { useMe } from '@/components/Shell';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface User {
  id: string;
  email: string | null;
  name: string;
  phone: string;
  role: Role;
  team: string | null;
  active: boolean;
  hubId: string | null;
  merchantId: string | null;
  hub: { code: string } | null;
  merchant: { name: string } | null;
}

const ROLE_LABELS: Record<Role, string> = { ADMIN: 'Admin', HUB_STAFF: 'Hub staff', COURIER: 'Courier', MERCHANT: 'Merchant', AGENT: 'Agent' };
const empty = { role: 'HUB_STAFF' as Role, name: '', email: '', phone: '', password: '', hubId: '', merchantId: '', team: '' };

export default function UsersPage() {
  const t = useT();
  const locale = useLocale();
  const teamLabel = (team: string) => (locale === 'ar' ? TEAM_LABELS_AR : TEAM_LABELS)[team as Team] ?? team;
  const me = useMe();
  const users = useLoad<User[]>('/admin/users');
  const hubs = useLoad<{ id: string; code: string; name: string; active: boolean; isSorting: boolean }[]>('/admin/hubs');
  const merchants = useLoad<{ id: string; name: string }[]>('/admin/merchants');
  const [form, setForm] = useState(empty);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');

  if (!users.data || !hubs.data || !merchants.data) {
    const err = users.error ?? hubs.error ?? merchants.error;
    return err ? <Alert>{err}</Alert> : <Loading />;
  }

  const needsHub = form.role === 'HUB_STAFF' || form.role === 'COURIER';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/users', {
        body: { ...form, hubId: needsHub ? form.hubId || null : null, merchantId: form.role === 'MERCHANT' ? form.merchantId || null : null, team: form.role === 'HUB_STAFF' ? form.team || null : null },
      });
      setMsg({ ok: true, text: t('Account created for {email}', { email: form.email }) });
      setForm({ ...empty, role: form.role, hubId: form.hubId });
      await users.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const update = async (u: User, body: Record<string, unknown>, done: string) => {
    setMsg(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PUT', body });
      setMsg({ ok: true, text: done });
      await users.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  const resetPassword = (u: User) => {
    const password = window.prompt(t('New password for {email} (8 characters or more)', { email: u.email ?? u.phone }));
    if (!password) return;
    void update(u, { password }, t('Password changed for {email}', { email: u.email ?? u.phone }));
  };

  const list = roleFilter ? users.data.filter((u) => u.role === roleFilter) : users.data;

  return (
    <div className="space-y-5">
      <PageHeader title={t('Users')} subtitle={t('Admins, facility teams, hub staff, couriers and merchant logins')} actions={<Button onClick={() => setCreating((c) => !c)}>{creating ? t('Close') : t('Add user')}</Button>} />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      {creating && (
        <Card title={t('New user')}>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('Role')}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.filter((r) => r !== 'AGENT').map((r) => (
                  <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>
                ))}
              </Select>
            </Field>
            {needsHub && (
              <Field label={t('Hub')}>
                <Select required value={form.hubId} onChange={(e) => setForm({ ...form, hubId: e.target.value })}>
                  <option value="" disabled>{t('Choose a hub')}</option>
                  {hubs.data.filter((h) => h.active).map((h) => (
                    <option key={h.id} value={h.id}>{h.code} · {h.name}{h.isSorting ? ` (${t('sorting facility')})` : ''}</option>
                  ))}
                </Select>
              </Field>
            )}
            {form.role === 'HUB_STAFF' && hubs.data.find((h) => h.id === form.hubId)?.isSorting && (
              <Field label={t('Team')} hint={t('A team member sees only their station. A supervisor sees every station')}>
                <Select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                  <option value="">{t('Supervisor (all stations)')}</option>
                  <option value="INBOUND">{teamLabel('INBOUND')}</option>
                  <option value="SORTING">{teamLabel('SORTING')}</option>
                  <option value="OUTBOUND">{teamLabel('OUTBOUND')}</option>
                </Select>
              </Field>
            )}
            {form.role === 'MERCHANT' && (
              <Field label={t('Merchant')}>
                <Select required value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })}>
                  <option value="" disabled>{t('Choose a merchant')}</option>
                  {merchants.data.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('Name')}>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('Email')}>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t('Phone')} hint={t('Egyptian mobile, optional')}>
              <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t('Password')} hint={t('8 characters or more')}>
              <Input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>{t('Create account')}</Button>
            </div>
          </form>
        </Card>
      )}
      <Card
        title={t('{count} accounts', { count: list.length })}
        actions={
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">{t('All roles')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(ROLE_LABELS[r])}</option>
            ))}
          </Select>
        }
      >
        <Table head={[t('Name'), t('Email'), t('Role'), t('Hub or merchant'), t('Status'), '']}>
          {list.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.name}
                {u.phone && <div className="ltr-iso text-caption text-text-muted">{u.phone}</div>}
              </Td>
              <Td><span className="ltr-iso">{u.email ?? ''}</span></Td>
              <Td><Badge tone={u.role === 'ADMIN' ? 'blue' : 'slate'}>{t(ROLE_LABELS[u.role])}</Badge></Td>
              <Td><span className="ltr-iso">{u.hub?.code ?? u.merchant?.name ?? ''}</span>{u.team ? <span className="ms-2 text-caption font-bold text-link">{teamLabel(u.team)}</span> : null}</Td>
              <Td>{u.active ? <Badge tone="green">{t('Active')}</Badge> : <Badge tone="red">{t('Inactive')}</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  {u.id !== me.id && (
                    <Button tone="ghost" onClick={() => update(u, { active: !u.active }, u.active ? t('{email} is now inactive', { email: u.email ?? u.phone }) : t('{email} is now active', { email: u.email ?? u.phone }))}>
                      {u.active ? t('Deactivate') : t('Activate')}
                    </Button>
                  )}
                  <Button tone="ghost" onClick={() => resetPassword(u)}>{t('Reset password')}</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
