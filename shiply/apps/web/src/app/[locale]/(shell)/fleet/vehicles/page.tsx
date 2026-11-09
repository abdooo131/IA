'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { FLEET_MENU } from '../menu';
import { AgentSelect, useFleetLookups } from '../shared';

interface Vehicle {
  id: string;
  agentId: string;
  plate: string;
  type: string;
  capacityKg: number | null;
  personId: string | null;
  active: boolean;
}
const TYPES = ['motorbike', 'car', 'van', 'truck'];

export default function VehiclesPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useFleetLookups();
  const [rows, setRows] = useState<Vehicle[] | null>(null);
  const [agentId, setAgent] = useState('');
  const load = useCallback(() => api<Vehicle[]>('/agents/vehicles').then(setRows, () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      await api('/agents/vehicles', { method: 'POST', json: { agentId, plate: f.plate, type: f.type, capacityKg: f.capacityKg ? Number(f.capacityKg) : undefined, personId: f.personId || undefined } });
      form.reset();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {atLeast(me.access.fleet, 'use') && (
        <form className="inline-form card" onSubmit={(e) => void create(e)}>
          <AgentSelect value={agentId} onChange={setAgent} agents={look.agents} label={t('fleet.agent')} render={look.agentLabel} />
          <label>
            {t('fleet.plate')}
            <input name="plate" required />
          </label>
          <label>
            {t('fleet.type')}
            <select name="type" aria-label={t('fleet.type')}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`fleet.vtypes.${x}` as never)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('fleet.capacity')}
            <input name="capacityKg" inputMode="numeric" size={6} />
          </label>
          <label>
            {t('fleet.assigned')}
            <select name="personId" aria-label={t('fleet.assigned')} defaultValue="">
              <option value="" />
              {look.people.filter((p) => p.agentId === agentId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary">{t('fleet.addVehicle')}</button>
        </form>
      )}
      <ListPage<Vehicle>
        title={t('fleet.vehicles')}
        columns={[
          { key: 'plate', label: t('fleet.plate'), render: (r) => r.plate },
          { key: 'agent', label: t('fleet.agent'), render: (r) => look.agent(r.agentId) },
          { key: 'type', label: t('fleet.type'), render: (r) => t(`fleet.vtypes.${r.type}` as never) },
          { key: 'capacity', label: t('fleet.capacity'), render: (r) => r.capacityKg ?? '' },
          { key: 'person', label: t('fleet.assigned'), render: (r) => look.person(r.personId) },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}
