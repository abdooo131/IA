'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/parcels/lib/api';
import { useT } from '@/parcels/lib/i18n';
import { useMe } from './Shell';
import { Card, Field, Loading, Select } from './ui';

interface Hub {
  id: string;
  code: string;
  name: string;
  isSorting: boolean;
}

const HubCtx = createContext<Hub | null>(null);
export function useHub(): Hub {
  const hub = useContext(HubCtx);
  if (!hub) throw new Error('useHub outside HubProvider');
  return hub;
}

/** Hub staff always work in their own hub. Admin picks one, remembered for this browser. */
export function HubProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [hubId, setHubId] = useState<string | null>(me.role === 'HUB_STAFF' ? me.hubId : null);

  useEffect(() => {
    if (me.role !== 'ADMIN') return;
    api<Hub[]>('/admin/hubs').then(setHubs).catch(() => setHubs([]));
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('shiply.hub');
    } catch {
      /* storage blocked */
    }
    setHubId(params.get('hubId') ?? saved);
  }, [me.role, params]);

  const choose = (id: string) => {
    setHubId(id);
    try {
      localStorage.setItem('shiply.hub', id);
    } catch {
      /* storage blocked */
    }
    if (params.get('hubId')) router.replace(window.location.pathname);
  };

  if (me.role === 'HUB_STAFF') {
    if (!me.hub) return <Card>{t("Your account is not linked to a hub. Ask an admin.")}</Card>;
    return <HubCtx.Provider value={me.hub}>{children}</HubCtx.Provider>;
  }
  if (!hubs) return <Loading />;
  const hub = hubs.find((h) => h.id === hubId);
  return (
    <>
      <div className="no-print mb-4 max-w-sm">
        <Field label={t("Working in")}>
          <Select value={hub?.id ?? ''} onChange={(e) => choose(e.target.value)}>
            <option value="" disabled>{t("Choose")}</option>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>{h.code} · {h.name}{h.isSorting ? ` ${t('(sorting facility)')}` : ''}</option>
            ))}
          </Select>
        </Field>
      </div>
      {hub ? <HubCtx.Provider value={hub}>{children}</HubCtx.Provider> : <Card>{t("Choose where you are working.")}</Card>}
    </>
  );
}
