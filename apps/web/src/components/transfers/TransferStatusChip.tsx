import { useTranslations } from 'next-intl';
import type { TransferStatus } from '@/lib/transfer-types';

const TONE: Record<TransferStatus, string> = {
  draft: 'bg-status-needs-action',
  approved: 'bg-status-new',
  picking: 'bg-status-in-progress',
  in_transit: 'bg-status-heading-to-customer',
  received: 'bg-status-delivered',
  cancelled: 'bg-text-muted',
};

export function TransferStatusChip({ status }: { status: TransferStatus }) {
  const t = useTranslations('transfers.statuses');
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-line px-3 py-1 text-caption font-bold">
      <span className={`h-2 w-2 rounded-full ${TONE[status]}`} aria-hidden />
      {t(status)}
    </span>
  );
}
