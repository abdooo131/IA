import { getLocale, getTranslations } from 'next-intl/server';
import { formatCairoTime } from '@/lib/format';

/** Open, closed or full. Always colour plus label, never colour alone. */
export async function StoreStatusChip(props: {
  openNow: boolean;
  atCapacity: boolean;
  nextOpenAt: string | null;
}) {
  const t = await getTranslations('admin.overview');
  const locale = await getLocale();
  const [label, dot] = !props.openNow
    ? [
        props.nextOpenAt
          ? `${t('closed')} · ${t('opensAt', { time: formatCairoTime(props.nextOpenAt, locale) })}`
          : t('closed'),
        'bg-status-new',
      ]
    : props.atCapacity
      ? [t('atCapacity'), 'bg-status-needs-action']
      : [t('openNow'), 'bg-status-delivered'];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-2.5 py-1 text-caption">
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
