'use client';
import { cx } from './ui';
import { useT } from '@/lib/i18n';

/**
 * The planned way of a parcel: merchant, the facility that picks it up, any facilities in between,
 * the last mile hub, the customer. The place it is at now is marked.
 */
export function RouteChain({ route, here, done, names }: { route: string[]; here?: string | null; done?: boolean; names?: Record<string, string> }) {
  const t = useT();
  if (!route.length) return null;
  const at = here ? route.indexOf(here) : -1;
  const steps = [{ code: t('Merchant'), place: false }, ...route.map((code) => ({ code, place: true })), { code: t('Customer'), place: false }];
  return (
    <ol dir="ltr" className="flex flex-wrap items-center gap-1 text-caption">
      {steps.map((s, i) => {
        const index = i - 1;
        const current = s.place && index === at;
        const passed = done || (at >= 0 && s.place && index < at) || (at >= 0 && i === 0);
        return (
          <li key={`${s.code}${i}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-text-muted">→</span>}
            <span
              title={s.place ? names?.[s.code] ?? s.code : undefined}
              className={cx('rounded-pill px-2 py-0.5 font-semibold', current ? 'bg-accent text-on-accent' : passed ? 'bg-selected-bg text-link' : 'bg-surface-raised text-text-muted', s.place && 'font-mono')}
            >
              {s.code}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
