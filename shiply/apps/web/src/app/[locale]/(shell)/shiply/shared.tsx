'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/shell/feedback';

export interface Site {
  id: string;
  kind: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
export interface Zone {
  id: string;
  hubId: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
export interface Person {
  id: string;
  name: string;
  nameAr: string;
  mobile: string | null;
  active: boolean;
}
export interface Lookups {
  sites: Site[];
  zones: Zone[];
  merchants: { id: string; code: string; name: string }[];
  couriers: Person[];
}

/** Names for every Shiply screen: sites, zones, merchants and couriers. */
export function useLookups() {
  const t = useTranslations();
  const locale = useLocale();
  const [l, setL] = useState<Lookups>({ sites: [], zones: [], merchants: [], couriers: [] });
  useEffect(() => {
    api<Lookups>('/parcels/lookups').then(setL, () => toast.error(t('common.failed')));
  }, [t]);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  return {
    ...l,
    site: (id: string | null) => l.sites.find((s) => s.id === id)?.code ?? '',
    zone: (id: string | null) => l.zones.find((z) => z.id === id)?.code ?? '',
    merchant: (id: string | null) => l.merchants.find((m) => m.id === id)?.name ?? '',
    person: (id: string | null) => {
      const p = l.couriers.find((c) => c.id === id);
      return p ? (locale === 'ar' ? p.nameAr : p.name) : '';
    },
    label: (s: Site | Zone) => `${s.code} · ${name(s)}`,
  };
}

/** The site a page works on, remembered per page kind. */
export function useSite(kind: 'sorting_facility' | 'last_mile_hub', sites: Site[]) {
  const key = `shiply.site.${kind}`;
  const [id, setId] = useState('');
  useEffect(() => {
    try {
      setId(localStorage.getItem(key) ?? '');
    } catch {
      /* not remembered */
    }
  }, [key]);
  const set = (v: string) => {
    setId(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* not remembered */
    }
  };
  const options = sites.filter((s) => s.kind === kind);
  return [options.some((s) => s.id === id) ? id : '', set, options] as const;
}

export function SitePicker(props: { value: string; onChange: (v: string) => void; options: Site[]; label: string; render: (s: Site) => string }) {
  return (
    <label>
      {props.label}
      <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="" />
        {props.options.map((s) => (
          <option key={s.id} value={s.id}>
            {props.render(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('shiply');
  return <span className={`pill${status === 'delivered' ? ' on' : ''}`}>{t(`statuses.${status}` as never)}</span>;
}
