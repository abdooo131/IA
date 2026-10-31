import { useTranslations } from 'next-intl';
import type { ReturnStatus } from '@/lib/return-types';

const TONE: Record<ReturnStatus, string> = {
  requested: 'bg-status-new',
  picking: 'bg-status-in-progress',
  ready: 'bg-status-heading-to-customer',
  collected: 'bg-status-delivered',
  cancelled: 'bg-text-muted',
};

export function ReturnStatusChip({ status }: { status: ReturnStatus }) {
  const t = useTranslations('returns.statuses');
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-line px-3 py-1 text-caption font-bold">
      <span className={`h-2 w-2 rounded-full ${TONE[status]}`} aria-hidden />
      {t(status)}
    </span>
  );
}
