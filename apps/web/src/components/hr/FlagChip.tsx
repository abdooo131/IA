import type { EmployeeFlag } from '@shiplynow/shared';

/** The colour of each list flag (outlined pills, as the status chips; brand v2 status inks). */
export const FLAG_TONE: Record<EmployeeFlag, string> = {
  missing_documents: 'border-status-needs-action text-status-needs-action',
  on_probation: 'border-status-new text-status-new',
  leaving: 'border-status-needs-action text-status-needs-action',
  left: 'border-danger text-danger',
  on_leave_today: 'border-status-in-progress text-status-in-progress',
  open_violations: 'border-danger text-danger',
};

export function FlagChip({ flag, label }: { flag: EmployeeFlag; label: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill border px-2 py-0.5 text-caption ${FLAG_TONE[flag]}`}
    >
      {label}
    </span>
  );
}
