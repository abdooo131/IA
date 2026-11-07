'use client';
import { useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { useT } from '@/parcels/lib/i18n';

export interface AgentProfile {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  supplies: 'PICKUP' | 'DELIVERY' | 'BOTH';
  nationalIdNo: string;
  commercialRegister: string;
  taxCardNo: string;
  bankName: string;
  bankAccountName: string;
  iban: string;
  commissionBp: number | null;
  effectiveCommissionBp: number;
  active: boolean;
}

export const SUPPLIES_LABEL = { PICKUP: 'Pickup staff', DELIVERY: 'Delivery staff', BOTH: 'Pickup and delivery staff' } as const;

/** Create or edit an agent's profile: contact, papers, bank account and commission. */
export function AgentForm({ agent, onSaved }: { agent: AgentProfile | null; onSaved: (a: AgentProfile) => void }) {
  const t = useT();
  const [f, setF] = useState({
    name: agent?.name ?? '',
    phone: agent?.phone ?? '',
    email: agent?.email ?? '',
    supplies: agent?.supplies ?? 'BOTH',
    nationalIdNo: agent?.nationalIdNo ?? '',
    commercialRegister: agent?.commercialRegister ?? '',
    taxCardNo: agent?.taxCardNo ?? '',
    bankName: agent?.bankName ?? '',
    bankAccountName: agent?.bankAccountName ?? '',
    iban: agent?.iban ?? '',
    commission: agent?.commissionBp != null ? String(agent.commissionBp / 100) : '',
    active: agent?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { commission, ...rest } = f;
      const body = { ...rest, commissionBp: commission === '' ? null : Math.round(Number(commission) * 100) };
      const saved = await api<AgentProfile>(agent ? `/admin/agents/${agent.id}` : '/admin/agents', { method: agent ? 'PUT' : 'POST', body });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('Agent name')}>
          <Input required minLength={2} value={f.name} onChange={set('name')} />
        </Field>
        <Field label={t('Phone')}>
          <Input required inputMode="tel" className="ltr-iso" value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('Email')} hint={t('Optional')}>
          <Input type="email" className="ltr-iso" value={f.email} onChange={set('email')} />
        </Field>
        <Field label={t('Supplies')}>
          <Select value={f.supplies} onChange={set('supplies')}>
            {Object.entries(SUPPLIES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{t(v)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('National ID number')}>
          <Input inputMode="numeric" className="ltr-iso" value={f.nationalIdNo} onChange={set('nationalIdNo')} />
        </Field>
        <Field label={t('Commercial register')}>
          <Input className="ltr-iso" value={f.commercialRegister} onChange={set('commercialRegister')} />
        </Field>
        <Field label={t('Tax card')}>
          <Input className="ltr-iso" value={f.taxCardNo} onChange={set('taxCardNo')} />
        </Field>
        <Field label={t('Bank')}>
          <Input value={f.bankName} onChange={set('bankName')} />
        </Field>
        <Field label={t('Account name')}>
          <Input value={f.bankAccountName} onChange={set('bankAccountName')} />
        </Field>
        <Field label="IBAN" hint={t('EG followed by 27 digits')}>
          <Input className="ltr-iso" value={f.iban} onChange={set('iban')} />
        </Field>
        <Field label={t('Commission %')} hint={agent ? t('Empty uses the default ({value}%)', { value: agent.effectiveCommissionBp / 100 }) : t('Empty uses the default in Settings')}>
          <Input inputMode="decimal" className="ltr-iso" value={f.commission} onChange={set('commission')} />
        </Field>
        {agent && (
          <label className="flex items-center gap-2 self-end text-body-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            {t('Active')}
          </label>
        )}
      </div>
      <Button type="submit" disabled={busy}>{agent ? t('Save') : t('Create agent')}</Button>
    </form>
  );
}
