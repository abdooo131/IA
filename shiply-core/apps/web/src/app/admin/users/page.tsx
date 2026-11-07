'use client';
import { useState } from 'react';
import { ROLES, type Role } from '@shiply/shared';
import { useMe } from '@/components/Shell';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';

interface User {
  id: string;
  email: string;
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

const ROLE_LABELS: Record<Role, string> = { ADMIN: 'Admin', HUB_STAFF: 'Hub staff', COURIER: 'Courier', MERCHANT: 'Merchant' };
const empty = { role: 'HUB_STAFF' as Role, name: '', email: '', phone: '', password: '', hubId: '', merchantId: '', team: '' };

export default function UsersPage() {
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
      setMsg({ ok: true, text: `Account created for ${form.email}` });
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
    const password = window.prompt(`New password for ${u.email} (8 characters or more)`);
    if (!password) return;
    void update(u, { password }, `Password changed for ${u.email}`);
  };

  const list = roleFilter ? users.data.filter((u) => u.role === roleFilter) : users.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Users" subtitle="Admins, hub staff, couriers and merchant logins" actions={<Button onClick={() => setCreating((c) => !c)}>{creating ? 'Close' : 'Add user'}</Button>} />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      {creating && (
        <Card title="New user">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </Field>
            {needsHub && (
              <Field label="Hub">
                <Select required value={form.hubId} onChange={(e) => setForm({ ...form, hubId: e.target.value })}>
                  <option value="" disabled>Choose a hub</option>
                  {hubs.data.filter((h) => h.active).map((h) => (
                    <option key={h.id} value={h.id}>{h.code} · {h.name}{h.isSorting ? ' (sorting facility)' : ''}</option>
                  ))}
                </Select>
              </Field>
            )}
            {form.role === 'HUB_STAFF' && hubs.data.find((h) => h.id === form.hubId)?.isSorting && (
              <Field label="Team" hint="A team member sees only their station. No team = supervisor, sees every station">
                <Select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                  <option value="">Supervisor (all stations)</option>
                  <option value="INBOUND">Inbound team</option>
                  <option value="SORTING">Sorting team</option>
                  <option value="OUTBOUND">Outbound team</option>
                </Select>
              </Field>
            )}
            {form.role === 'MERCHANT' && (
              <Field label="Merchant">
                <Select required value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })}>
                  <option value="" disabled>Choose a merchant</option>
                  {merchants.data.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Name">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Egyptian mobile, optional">
              <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Password" hint="8 characters or more">
              <Input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>Create account</Button>
            </div>
          </form>
        </Card>
      )}
      <Card
        title={`${list.length} accounts`}
        actions={
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
        }
      >
        <Table head={['Name', 'Email', 'Role', 'Hub or merchant', 'Status', '']}>
          {list.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.name}
                {u.phone && <div className="text-xs text-slate-500">{u.phone}</div>}
              </Td>
              <Td>{u.email}</Td>
              <Td><Badge tone={u.role === 'ADMIN' ? 'blue' : 'slate'}>{ROLE_LABELS[u.role]}</Badge></Td>
              <Td>{u.hub?.code ?? u.merchant?.name ?? ''}{u.team ? <span className="ml-1 text-xs text-brand-700">{u.team.toLowerCase()} team</span> : null}</Td>
              <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  {u.id !== me.id && (
                    <Button tone="ghost" onClick={() => update(u, { active: !u.active }, `${u.email} is now ${u.active ? 'inactive' : 'active'}`)}>
                      {u.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                  <Button tone="ghost" onClick={() => resetPassword(u)}>Reset password</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
