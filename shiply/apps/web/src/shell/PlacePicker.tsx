'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface PlaceRow {
  id: string;
  path: { id: string; nameEn: string; nameAr: string }[];
}

/** Choose a place: the given suggestions first, then a search over every place. */
export function PlacePicker(props: {
  title: string;
  suggestions?: { id: string; label: string }[];
  onPick: (placeId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations();
  const ar = useLocale() === 'ar';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlaceRow[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    const timer = setTimeout(() => {
      api<{ rows: PlaceRow[] }>(`/location/places?q=${encodeURIComponent(q.trim())}`).then((r) => setRows(r.rows), () => setRows([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);
  const label = (r: PlaceRow) => r.path.map((p) => (ar ? p.nameAr : p.nameEn)).join(' › ');
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <h2 id="picker-title">{props.title}</h2>
        {props.suggestions && props.suggestions.length > 0 && (
          <div className="picker-list">
            {props.suggestions.map((s) => (
              <button key={s.id} className="btn ghost" onClick={() => void props.onPick(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('location.searchPlaces')} aria-label={t('location.searchPlaces')} autoFocus dir="auto" />
        <div className="picker-list">
          {rows.map((r) => (
            <button key={r.id} className="btn ghost" onClick={() => void props.onPick(r.id)}>
              {label(r)}
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
