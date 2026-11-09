'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { LOCATION_MENU } from '../menu';

interface PlaceRow {
  id: string;
  kind: string;
  names: string[];
  path: { id: string; nameEn: string; nameAr: string }[];
}
const KINDS = ['governorate', 'city', 'district', 'neighbourhood', 'compound', 'landmark', 'street'];

export default function PlacesPage() {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const ar = useLocale() === 'ar';
  const router = useRouter();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: PlaceRow[]; total: number } | null>(null);
  useEffect(() => {
    api<{ rows: PlaceRow[]; total: number }>(`/location/places?page=${page}&q=${encodeURIComponent(q)}&kind=${kind}`).then(setData, () => toast.error(tc('failed')));
  }, [page, q, kind, tc]);
  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <ListPage<PlaceRow>
        title={t('places')}
        filters={
          <>
            <input type="search" value={q} onChange={(e) => (setPage(1), setQ(e.target.value))} placeholder={t('searchPlaces')} aria-label={t('searchPlaces')} dir="auto" />
            <select value={kind} onChange={(e) => (setPage(1), setKind(e.target.value))} aria-label={t('kind')}>
              <option value="">{t('kind')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </>
        }
        columns={[
          { key: 'path', label: t('path'), render: (r) => r.path.map((p) => (ar ? p.nameAr : p.nameEn)).join(' › ') },
          { key: 'kind', label: t('kind'), render: (r) => t(`kinds.${r.kind}`) },
          { key: 'names', label: t('spellings'), render: (r) => <span dir="auto">{r.names.slice(0, 4).join('، ')}{r.names.length > 4 ? '…' : ''}</span> },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        loading={!data}
        onRowClick={(r) => router.push(`/location/places/${r.id}`)}
      />
    </AppShell>
  );
}
