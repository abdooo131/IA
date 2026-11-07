'use client';
import { useParams } from 'next/navigation';
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
  Select,
  Table,
  Td,
} from '@/parcels/components/ui';
import { StaffPanel, VehiclesPanel } from '@/parcels/components/workforce';
import { api, errorMessage } from '@/parcels/lib/api';
import { dateTime } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';
import { AgentForm, SUPPLIES_LABEL, type AgentProfile } from '../AgentForm';

type Detail = AgentProfile & {
  documents: {
    id: string;
    kind: string;
    fileName: string;
    mime: string;
    size: number;
    createdAt: string;
  }[];
  logins: { id: string; name: string; email: string | null; active: boolean }[];
};

const DOC_KIND: Record<string, string> = {
  NATIONAL_ID: 'National ID',
  COMMERCIAL_REGISTER: 'Commercial register',
  TAX_CARD: 'Tax card',
  CONTRACT: 'Contract',
  OTHER: 'Other',
};

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export default function AgentDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const agent = useLoad<Detail>(`/admin/agents/${id}`);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [docKind, setDocKind] = useState('NATIONAL_ID');
  const [login, setLogin] = useState({ name: '', email: '', password: '' });

  if (!agent.data) return agent.error ? <Alert>{agent.error}</Alert> : <Loading />;
  const a = agent.data;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(t('The file is larger than 5 MB'));
      await api(`/admin/agents/${id}/documents`, {
        body: {
          kind: docKind,
          fileName: file.name,
          mime: file.type,
          dataBase64: await readBase64(file),
        },
      });
      setMsg({ ok: true, text: t('Uploaded {name}', { name: file.name }) });
      await agent.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  const addLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api(`/admin/agents/${id}/logins`, { body: login });
      setMsg({ ok: true, text: t('Account created for {email}', { email: login.email }) });
      setLogin({ name: '', email: '', password: '' });
      await agent.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Agent code {code}', { code: a.code })}
        title={a.name}
        subtitle={`${t(SUPPLIES_LABEL[a.supplies])} · ${t('Commission')} ${a.effectiveCommissionBp / 100}%`}
        actions={
          <Button tone="secondary" onClick={() => setEditing((x) => !x)}>
            {editing ? t('Close') : t('Edit profile')}
          </Button>
        }
      />
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      {!a.active && (
        <Alert tone="warning">{t('This agent is inactive. Staff cannot join with its code')}</Alert>
      )}
      {editing ? (
        <Card title={t('Profile')}>
          <AgentForm
            agent={a}
            onSaved={() => {
              setEditing(false);
              setMsg({ ok: true, text: t('Saved {name}', { name: a.name }) });
              void agent.reload();
            }}
          />
        </Card>
      ) : (
        <Card title={t('Profile')}>
          <dl className="grid gap-3 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t('Phone'), a.phone],
              [t('Email'), a.email],
              [t('National ID number'), a.nationalIdNo],
              [t('Commercial register'), a.commercialRegister],
              [t('Tax card'), a.taxCardNo],
              [t('Bank'), [a.bankName, a.bankAccountName].filter(Boolean).join(' · ')],
              ['IBAN', a.iban],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-caption text-text-muted">{k}</dt>
                <dd className="ltr-iso font-semibold">{v || t('Not set')}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('Papers')}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('Kind')}>
                <Select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  {Object.entries(DOC_KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="btn-secondary cursor-pointer">
                {t('Upload file')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {a.documents.length === 0 ? (
              <Empty>{t('No papers uploaded')}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {a.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 py-2 text-body-sm"
                  >
                    <span>
                      <Badge tone="blue">{t(DOC_KIND[d.kind] ?? d.kind)}</Badge>
                      <a
                        href={`/api/parcels/admin/agents/${id}/documents/${d.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ms-2 font-bold text-link"
                      >
                        {d.fileName}
                      </a>
                    </span>
                    <span className="text-caption text-text-muted">{dateTime(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card title={t('Agent portal logins')}>
          <div className="space-y-3">
            {a.logins.length > 0 && (
              <Table head={[t('Name'), t('Email'), t('Status')]}>
                {a.logins.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.name}</Td>
                    <Td>
                      <span className="ltr-iso">{l.email}</span>
                    </Td>
                    <Td>
                      {l.active ? (
                        <Badge tone="green">{t('Active')}</Badge>
                      ) : (
                        <Badge tone="red">{t('Inactive')}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <form onSubmit={addLogin} className="grid gap-2 sm:grid-cols-3">
              <Input
                required
                minLength={2}
                placeholder={t('Name')}
                value={login.name}
                onChange={(e) => setLogin({ ...login, name: e.target.value })}
              />
              <Input
                required
                type="email"
                placeholder={t('Email')}
                className="ltr-iso"
                value={login.email}
                onChange={(e) => setLogin({ ...login, email: e.target.value })}
              />
              <Input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                placeholder={t('Password')}
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
              />
              <div className="sm:col-span-3">
                <Button type="submit">{t('Create login')}</Button>
              </div>
            </form>
          </div>
        </Card>
      </div>
      <StaffPanel base={`/admin/agents/${id}`} supplies={a.supplies} joinCode={a.code} />
      <VehiclesPanel base={`/admin/agents/${id}`} />
    </div>
  );
}
