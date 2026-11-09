'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { PlacePicker } from '@/shell/PlacePicker';
import { toast } from '@/shell/feedback';
import { LOCATION_MENU } from '../menu';

interface Result {
  input: string;
  status: string;
  confidence: number;
  path: { id: string; en: string; ar: string }[];
  parts: Record<string, string | undefined>;
  reasons: string[];
  unknownWords: string[];
}
interface Bulk {
  note: string;
  csv: string;
  summary: { total: number; placedShare: number; byStatus: Record<string, number>; unknownWords: { word: string; count: number }[] };
  results: Result[];
}

const PARTS = ['governorate', 'city', 'neighbourhood', 'compound', 'street', 'building', 'floor', 'apartment', 'villa', 'block', 'entrance', 'landmark', 'phone'];

export default function FinderPage() {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const ar = useLocale() === 'ar';
  const [tab, setTab] = useState<'one' | 'many'>('one');
  const [address, setAddress] = useState('');
  const [one, setOne] = useState<Result | null>(null);
  const [text, setText] = useState('');
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [busy, setBusy] = useState(false);
  const [teaching, setTeaching] = useState<string | null>(null);

  useEffect(() => {
    if (!address.trim()) return setOne(null);
    const timer = setTimeout(() => {
      api<Result>('/location/find', { method: 'POST', json: { address }, idempotent: false }).then(setOne, () => toast.error(tc('failed')));
    }, 250);
    return () => clearTimeout(timer);
  }, [address, tc]);

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setBulk(await api<Bulk>('/location/find/bulk', { method: 'POST', json: { text }, idempotent: false }));
    } catch {
      toast.error(tc('failed'));
    }
    setBusy(false);
  };
  const teach = async (placeId: string) => {
    if (!teaching) return;
    try {
      await api('/location/taught', { method: 'POST', json: { name: teaching, placeId } });
      toast.success(tc('saved'));
    } catch {
      toast.error(tc('failed'));
    }
    setTeaching(null);
  };
  const pathText = (r: Result) => r.path.map((p) => (ar ? p.ar : p.en)).join(' › ');
  const download = () => {
    if (!bulk) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bulk.csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'address-results.csv';
    a.click();
  };

  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <h1>{t('finder')}</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'one'} className={tab === 'one' ? 'tab active' : 'tab'} onClick={() => setTab('one')}>
          {t('one')}
        </button>
        <button role="tab" aria-selected={tab === 'many'} className={tab === 'many' ? 'tab active' : 'tab'} onClick={() => setTab('many')}>
          {t('many')}
        </button>
      </div>
      {tab === 'one' ? (
        <section className="card form-wide">
          <label className="field-label">
            {t('address')}
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} dir="auto" rows={3} />
          </label>
          {one && (
            <div className="finder-result">
              <p>
                <span className="pill">{t(`status.${one.status}`)}</span> <span className="muted">{one.confidence}%</span>
              </p>
              <h2 data-testid="finder-path">{one.path.length ? pathText(one) : t('noArea')}</h2>
              <dl className="fields">
                {PARTS.filter((p) => one.parts[p]).map((p) => [<dt key={`${p}t`}>{t(`parts.${p}`)}</dt>, <dd key={`${p}d`} dir="auto">{one.parts[p]}</dd>])}
              </dl>
              <h3>{t('why')}</h3>
              <ul>
                {one.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {one.unknownWords.length > 0 && (
                <div className="chips" data-testid="unknown">
                  {one.unknownWords.map((w) => (
                    <span key={w} className="chip">
                      {w} <button onClick={() => setTeaching(w)}>{t('teach')}</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="card form-wide">
          <label className="field-label">
            {t('addresses')}
            <textarea value={text} onChange={(e) => setText(e.target.value)} dir="auto" rows={6} />
          </label>
          <div className="row-actions">
            <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={async (e) => setText((await e.target.files?.[0]?.text()) ?? text)} />
            <button className="btn primary" onClick={() => void run()} disabled={busy}>
              {t('run')}
            </button>
            {bulk && (
              <button className="btn ghost" onClick={download}>
                {t('download')}
              </button>
            )}
          </div>
          {bulk && (
            <>
              <p>
                <span className="big" data-testid="placed-share">{bulk.summary.placedShare}%</span> <span className="muted">{t('placedShare')}</span>
              </p>
              <p className="muted">{Object.entries(bulk.summary.byStatus).map(([k, n]) => `${t(`status.${k}`)}: ${n}`).join(' · ')}</p>
              <h3>{t('unknown')}</h3>
              <div className="chips" data-testid="unknown">
                {bulk.summary.unknownWords.map((w) => (
                  <span key={w.word} className="chip">
                    {w.word} <span className="muted">{w.count}</span> <button onClick={() => setTeaching(w.word)}>{t('teach')}</button>
                  </span>
                ))}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {bulk.results.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        <td dir="auto">{r.input}</td>
                        <td>{t(`status.${r.status}`)}</td>
                        <td>{pathText(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      {teaching && <PlacePicker title={t('teachTitle', { word: teaching })} onPick={teach} onClose={() => setTeaching(null)} />}
    </AppShell>
  );
}
