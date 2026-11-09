'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { toast } from '@/shell/feedback';
import { useReason } from '../fleet/shared';
import type { RequestRow } from '../fleet/requests/page';

interface Overview {
  agent: { code: string; name: string; nameAr: string };
  people: { id: string; name: string; nameAr: string; role: string; status: string; blocked: boolean; blockedReason: string | null; cashHeld: number }[];
  vehicles: { id: string; plate: string; type: string }[];
  expired: { id: string; kind: string; number: string; expiresAt: string }[];
  expiring: { id: string; kind: string; number: string; expiresAt: string }[];
}
interface Settlement {
  id: string;
  from: string;
  to: string;
  gross: number;
  cashHeld: number;
  net: number;
  status: string;
}

/** The agent manager's own screen (desktop or phone): only his agent. */
export default function AgentScreen() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const reason = useReason();
  const [o, setO] = useState<Overview | null>(null);
  const [reqs, setReqs] = useState<RequestRow[]>([]);
  const [sets, setSets] = useState<Settlement[]>([]);
  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([api<Overview>('/agents/me/overview'), api<RequestRow[]>('/agents/me/requests'), api<Settlement[]>('/agents/me/settlements')]);
    setO(a);
    setReqs(b);
    setSets(c);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const answer = async (id: string, how: 'confirm' | 'decline') => {
    try {
      await api(`/agents/me/requests/${id}/${how}`, { method: 'POST' });
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  if (!o) return <main className="field-page" aria-busy="true" />;
  const name = (x: { name: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.name);
  return (
    <main className="field-page">
      <h1>{name(o.agent)}</h1>
      <section className="card">
        <h2>{t('fleet.myPeople')}</h2>
        {o.people.map((p) => (
          <div key={p.id} className="row-actions" data-testid="person">
            <strong>{name(p)}</strong>
            <span>{t(`fleet.roles.${p.role}` as never)}</span>
            <span className="pill">{p.blocked ? `${t('fleet.blocked')}: ${reason(p.blockedReason)}` : t(`fleet.pstatus.${p.status}` as never)}</span>
            <span>
              {t('fleet.holds')} {formatEgp(p.cashHeld, locale)}
            </span>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>{t('fleet.toRenew')}</h2>
        {[...o.expired, ...o.expiring].map((d) => (
          <div key={d.id} className="row-actions">
            <span>{t(`fleet.docs.${d.kind}` as never)}</span>
            <span dir="ltr">{d.number}</span>
            <span>{d.expiresAt.slice(0, 10)}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>{t('fleet.myRequests')}</h2>
        {reqs.map((r) => (
          <div key={r.id} className="row-actions" data-testid="request">
            <span>{r.date.slice(0, 10)}</span>
            <span>{`${r.count} × ${t(`fleet.roles.${r.role}` as never)}`}</span>
            <span className="pill">{t(`fleet.rstatus.${r.status}` as never)}</span>
            {r.status === 'open' && (
              <>
                <button className="btn primary" onClick={() => void answer(r.id, 'confirm')}>
                  {t('fleet.confirm')}
                </button>
                <button className="btn" onClick={() => void answer(r.id, 'decline')}>
                  {t('fleet.decline')}
                </button>
              </>
            )}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>{t('fleet.mySettlements')}</h2>
        {sets.map((s) => (
          <div key={s.id} className="row-actions">
            <span>{`${s.from.slice(0, 10)} → ${s.to.slice(0, 10)}`}</span>
            <span>
              {t('fleet.gross')} {formatEgp(s.gross, locale)}
            </span>
            <span>
              {t('fleet.cashHeld')} {formatEgp(s.cashHeld, locale)}
            </span>
            <strong>
              {t('fleet.net')} {formatEgp(s.net, locale)}
            </strong>
            <span className="pill">{t(`fleet.sstatus.${s.status}` as never)}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
