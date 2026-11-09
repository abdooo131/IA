'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/shell/feedback';

export interface FleetLookups {
  agents: { id: string; code: string; name: string; nameAr: string; active: boolean }[];
  sites: { id: string; kind: string; code: string; nameEn: string; nameAr: string }[];
  people: { id: string; userId: string; agentId: string; name: string; nameAr: string }[];
}

export function useFleetLookups() {
  const t = useTranslations();
  const locale = useLocale();
  const [l, setL] = useState<FleetLookups>({ agents: [], sites: [], people: [] });
  useEffect(() => {
    api<FleetLookups>('/agents/lookups').then(setL, () => toast.error(t('common.failed')));
  }, [t]);
  const ar = locale === 'ar';
  return {
    ...l,
    agent: (id: string | null) => {
      const a = l.agents.find((x) => x.id === id);
      return a ? (ar ? a.nameAr : a.name) : '';
    },
    site: (id: string | null) => l.sites.find((s) => s.id === id)?.code ?? '',
    person: (id: string | null) => {
      const p = l.people.find((x) => x.id === id || x.userId === id);
      return p ? (ar ? p.nameAr : p.name) : '';
    },
    agentLabel: (a: { code: string; name: string; nameAr: string }) => `${a.code} · ${ar ? a.nameAr : a.name}`,
  };
}

/** "driving_licence, insurance ABC123" in the person's words. */
export function useReason() {
  const t = useTranslations('fleet');
  return (reason: string | null) =>
    (reason ?? '')
      .split(', ')
      .filter(Boolean)
      .map((part) => {
        const [kind, ...rest] = part.split(' ');
        return [t.has(`docs.${kind}` as never) ? t(`docs.${kind}` as never) : kind, ...rest].join(' ');
      })
      .join(', ');
}

export function AgentSelect({ value, onChange, name, agents, label, render, any }: { value?: string; onChange?: (v: string) => void; name?: string; agents: FleetLookups['agents']; label: string; render: (a: FleetLookups['agents'][number]) => string; any?: string }) {
  return (
    <label>
      {label}
      <select name={name} aria-label={label} value={value} defaultValue={value === undefined ? '' : undefined} onChange={onChange ? (e) => onChange(e.target.value) : undefined} required={!any}>
        <option value="" disabled={!any}>
          {any ?? ''}
        </option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {render(a)}
          </option>
        ))}
      </select>
    </label>
  );
}
