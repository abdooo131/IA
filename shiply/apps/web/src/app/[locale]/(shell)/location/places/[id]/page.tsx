'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { LoadError } from '@/shell/LoadError';
import { PlacePicker } from '@/shell/PlacePicker';
import { RecordPage } from '@/shell/RecordPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { LOCATION_MENU } from '../../menu';

interface Place {
  id: string;
  kind: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  names: string[];
  active: boolean;
  taught: { id: string; name: string; at: string }[];
}

export default function PlacePage() {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const ar = useLocale() === 'ar';
  const me = useMe();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [spelling, setSpelling] = useState('');
  const [merging, setMerging] = useState(false);
  const load = useCallback(() => api<Place>(`/location/places/${id}`).then(setPlace, setError), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <AppShell app="location" menu={LOCATION_MENU}><LoadError error={error} onRetry={() => void load()} /></AppShell>;
  if (!place) return <AppShell app="location" menu={LOCATION_MENU}>{null}</AppShell>;
  const canManage = atLeast(me.access.location, 'manage');
  const save = async (names: string[]) => {
    try {
      await api(`/location/places/${id}`, { method: 'PATCH', json: { names } });
      toast.success(tc('saved'));
      await load();
    } catch {
      toast.error(tc('failed'));
    }
  };
  const merge = async (intoId: string) => {
    setMerging(false);
    if (!(await confirm({ title: t('merge'), body: t('mergeBody', { name: ar ? place.nameAr : place.nameEn }), danger: true }))) return;
    try {
      await api(`/location/places/${id}/merge`, { method: 'POST', json: { intoId } });
      toast.success(tc('saved'));
      router.push(`/location/places/${intoId}`);
    } catch {
      toast.error(tc('failed'));
    }
  };
  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <RecordPage
        back={<Link href="/location/places">‹ {t('places')}</Link>}
        number={ar ? place.nameAr : place.nameEn}
        status={<span className="pill">{t(`kinds.${place.kind}`)}</span>}
        actions={
          canManage && place.active ? (
            <button className="btn ghost" onClick={() => setMerging(true)}>
              {t('merge')}
            </button>
          ) : undefined
        }
        tabs={[
          {
            key: 'details',
            label: t('details'),
            content: (
              <div className="form-wide">
                <dl className="fields">
                  <dt>{t('name')}</dt>
                  <dd>{place.nameEn}</dd>
                  <dt>{t('nameAr')}</dt>
                  <dd>{place.nameAr}</dd>
                  <dt>{t('parent')}</dt>
                  <dd>{place.parentId ?? ''}</dd>
                </dl>
                <h3>{t('spellings')}</h3>
                <div className="chips">
                  {place.names.map((n) => (
                    <span key={n} className="chip" dir="auto">
                      {n}
                      {canManage && <button onClick={() => void save(place.names.filter((x) => x !== n))}>{t('remove')}</button>}
                    </span>
                  ))}
                </div>
                {canManage && (
                  <form
                    className="row-actions"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (spelling.trim()) void save([...place.names, spelling.trim()]).then(() => setSpelling(''));
                    }}
                  >
                    <input value={spelling} onChange={(e) => setSpelling(e.target.value)} aria-label={t('addSpelling')} placeholder={t('addSpelling')} dir="auto" />
                    <button className="btn primary">{t('addSpelling')}</button>
                  </form>
                )}
              </div>
            ),
          },
          {
            key: 'taught',
            label: t('taught'),
            content: (
              <ul>
                {place.taught.map((x) => (
                  <li key={x.id} dir="auto">
                    {x.name} <span className="muted">{new Date(x.at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
        timeline={[]}
      />
      {merging && <PlacePicker title={t('merge')} onPick={merge} onClose={() => setMerging(false)} />}
    </AppShell>
  );
}
