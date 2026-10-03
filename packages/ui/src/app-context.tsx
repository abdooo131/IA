'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, AppName, createClient, loadSession, saveSession, Session, API_URL } from './api';
import { Dict, DICTS, Lang } from './i18n';

interface AppState {
  app: AppName;
  session: Session | null;
  ready: boolean;
  api: ApiClient;
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

const LANG_KEY = 'shiply.lang';

export function AppProvider({ app, children }: { app: AppName; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>('en');

  const api = useMemo(
    () =>
      createClient(app, () => {
        setSession(null);
      }),
    [app],
  );

  useEffect(() => {
    const s = loadSession(app);
    setSession(s);
    let l: Lang = s?.user.language ?? 'en';
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (!s && (stored === 'ar' || stored === 'en')) l = stored;
    } catch {
      /* ignore */
    }
    setLangState(l);
    setReady(true);
  }, [app]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback(
    async (l: Lang) => {
      setLangState(l);
      try {
        localStorage.setItem(LANG_KEY, l);
      } catch {
        /* ignore */
      }
      const s = loadSession(app);
      if (s) {
        // Language is stored per user on the server.
        await api.patch('/auth/me/language', { language: l }).catch(() => undefined);
        const next = { ...s, user: { ...s.user, language: l } };
        saveSession(app, next);
        setSession(next);
      }
    },
    [api, app],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, app }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? 'Login failed');
      saveSession(app, body);
      setSession(body);
      setLangState(body.user.language);
    },
    [app],
  );

  const logout = useCallback(async () => {
    const s = loadSession(app);
    if (s) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      }).catch(() => undefined);
    }
    saveSession(app, null);
    setSession(null);
  }, [app]);

  const value: AppState = { app, session, ready, api, lang, t: DICTS[lang], setLang, login, logout };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
