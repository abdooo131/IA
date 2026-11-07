'use client';
import { STATUS_LABELS, STATUS_LABELS_AR, type ShipmentStatus } from '@shiplynow/shared/parcels';
import { useLocale, useT } from '@/parcels/lib/i18n';

/**
 * The path each kind of record walks, and the side states that end it early (as in Shiply Now).
 */
export const WORKFLOWS = {
  parcel: {
    path: ['CREATED', 'PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    side: ['ATTEMPT_FAILED', 'ON_HOLD', 'RETURNED', 'CANCELLED', 'LOST'],
  },
  returnParcel: {
    path: ['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'RETURNED'],
    side: ['ATTEMPT_FAILED', 'ON_HOLD', 'LOST'],
  },
  payout: { path: ['PENDING_APPROVAL', 'APPROVED', 'PAID'], side: ['CANCELLED'] },
  request: { path: ['PENDING_APPROVAL', 'APPROVED', 'PAID'], side: ['REJECTED'] },
} as const;
export type WorkflowName = keyof typeof WORKFLOWS;

const LABELS: Record<string, string> = { PENDING_APPROVAL: 'Waiting for approval', APPROVED: 'Approved', PAID: 'Paid', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/**
 * Where a record is on its path, like a form's status bar: done steps ticked, the current one
 * lit, later ones grey. A side state replaces the end in red. On phones only the step before,
 * the current one and the next one show, so nothing is cut.
 */
export function StatusBar({ flow, status }: { flow: WorkflowName; status: string }) {
  const t = useT();
  const locale = useLocale();
  const { path, side } = WORKFLOWS[flow];
  const steps = path as readonly string[];
  const off = (side as readonly string[]).includes(status);
  const at = steps.indexOf(status);
  const label = (s: string) => (LABELS[s] ? t(LABELS[s]!) : ((locale === 'ar' ? STATUS_LABELS_AR : STATUS_LABELS)[s as ShipmentStatus] ?? s));
  return (
    <ol className="mt-3 flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface text-caption" aria-label={t('Status')}>
      {steps.map((s, i) => {
        const done = !off && at > i;
        const current = !off && at === i;
        const far = off ? i < steps.length - 1 : Math.abs(i - at) > 1;
        return (
          <li
            key={s}
            aria-current={current ? 'step' : undefined}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap px-3 py-2 ${far ? 'max-sm:hidden' : ''} ${i > 0 ? 'border-s border-line' : ''} ${
              current ? 'bg-primary font-bold text-on-primary' : done ? 'text-text' : 'text-text-muted'
            }`}
          >
            {done && <span aria-hidden>✓</span>}
            {label(s)}
          </li>
        );
      })}
      {off && <li aria-current="step" className="flex shrink-0 items-center whitespace-nowrap border-s border-line bg-danger px-3 py-2 font-bold text-on-primary">{label(status)}</li>}
    </ol>
  );
}
