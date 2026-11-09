'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { toast } from '@/shell/feedback';
import { FLEET_MENU } from '../menu';
import { useFleetLookups } from '../shared';

interface Doc {
  id: string;
  personId: string | null;
  vehicleId: string | null;
  kind: string;
  number: string;
  expiresAt: string;
}

export default function CompliancePage() {
  const t = useTranslations();
  const look = useFleetLookups();
  const [r, setR] = useState<{ expired: Doc[]; expiring: Doc[]; days: number } | null>(null);
  useEffect(() => {
    api<{ expired: Doc[]; expiring: Doc[]; days: number }>('/agents/compliance').then(setR, () => toast.error(t('common.failed')));
  }, [t]);
  const table = (docs: Doc[]) => (
    <table className="table">
      <tbody>
        {docs.map((d) => (
          <tr key={d.id} data-testid="row">
            <td>{d.personId ? look.person(d.personId) : d.vehicleId}</td>
            <td>{t(`fleet.docs.${d.kind}` as never)}</td>
            <td dir="ltr">{d.number}</td>
            <td>{d.expiresAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      <h1>{t('fleet.compliance')}</h1>
      <h2>{t('fleet.expired')}</h2>
      {r && table(r.expired)}
      <h2>{t('fleet.expiring', { days: r?.days ?? 30 })}</h2>
      {r && table(r.expiring)}
    </AppShell>
  );
}
