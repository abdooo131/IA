'use client';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppId, Level } from '@shiply/shared';
import { api } from '@/lib/api';

export interface Me {
  id: string;
  name: string;
  nameAr: string;
  kind: string;
  access: Record<AppId, Level>;
}

const MeContext = createContext<Me | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api<Me>('/me').then(setMe, () => setFailed(true));
  };
  useEffect(load, []);
  if (failed)
    return (
      <main className="page empty" data-testid="load-error">
        <p>{t('loadFailed')}</p>
        <button className="btn primary" onClick={load}>
          {t('tryAgain')}
        </button>
      </main>
    );
  if (!me) return <div className="page-loading" aria-busy="true" />;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeProvider');
  return me;
}
