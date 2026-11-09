'use client';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { Link } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { LoadError } from '@/shell/LoadError';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { FLEET_MENU } from '../../menu';
import { useFleetLookups, useReason } from '../../shared';
import type { PersonRow } from '../page';

interface Full extends PersonRow {
  nationalId: string | null;
  vehicles: { id: string; plate: string; type: string }[];
  documents: { id: string; kind: string; number: string; expiresAt: string | null; vehicleId: string | null }[];
}

const KINDS = ['national_id', 'driving_licence', 'vehicle_licence', 'insurance', 'criminal_record'];

export default function PersonPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useFleetLookups();
  const reason = useReason();
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Full | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const load = useCallback(() => api<Full>(`/agents/people/${id}`).then(setP, setFailed), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <AppShell app="fleet" menu={FLEET_MENU}><LoadError error={failed} /></AppShell>;
  if (!p) return <AppShell app="fleet" menu={FLEET_MENU}>{null}</AppShell>;
  const addDoc = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const vehicleKind = f.kind === 'vehicle_licence' || f.kind === 'insurance';
    const target = vehicleKind && p.vehicles[0] ? { vehicleId: p.vehicles[0].id } : { personId: p.id };
    try {
      await api('/agents/documents', { method: 'POST', json: { ...target, kind: f.kind, number: f.number, expiresAt: f.expiresAt || undefined } });
      form.reset();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      <Link href="/fleet/people">{t('fleet.people')}</Link>
      <h1>{p.name}</h1>
      <div className="card fields">
        <div className="field"><span>{t('fleet.agent')}</span><strong>{look.agent(p.agentId)}</strong></div>
        <div className="field"><span>{t('fleet.role')}</span><strong>{t(`fleet.roles.${p.role}` as never)}</strong></div>
        <div className="field"><span>{t('fleet.mobile')}</span><strong dir="ltr">{p.mobile}</strong></div>
        <div className="field"><span>{t('fleet.status')}</span><strong>{t(`fleet.pstatus.${p.status}` as never)}</strong></div>
        {p.blocked && (
          <div className="field" data-testid="blocked">
            <span>{t('fleet.blocked')}</span>
            <strong>{reason(p.blockedReason)}</strong>
          </div>
        )}
        <div className="field"><span>{t('fleet.vehicles')}</span><strong>{p.vehicles.map((v) => v.plate).join(', ')}</strong></div>
      </div>
      <h2>{t('fleet.documents')}</h2>
      <table className="table">
        <tbody>
          {p.documents.map((d) => (
            <tr key={d.id}>
              <td>{t(`fleet.docs.${d.kind}` as never)}</td>
              <td dir="ltr">{d.number}</td>
              <td>{d.expiresAt ? d.expiresAt.slice(0, 10) : t('fleet.noExpiry')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {atLeast(me.access.fleet, 'use') && (
        <form className="inline-form card" onSubmit={(e) => void addDoc(e)}>
          <label>
            {t('fleet.document')}
            <select name="kind" aria-label={t('fleet.document')} defaultValue="driving_licence">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`fleet.docs.${k}` as never)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('fleet.number')}
            <input name="number" required dir="ltr" />
          </label>
          <label>
            {t('fleet.expires')}
            <input name="expiresAt" type="date" />
          </label>
          <button className="btn primary">{t('fleet.addDocument')}</button>
        </form>
      )}
    </AppShell>
  );
}
