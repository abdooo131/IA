import { TONE_CLASS, tone } from '@/lib/attendance-types';

/** An attendance status or Today board state: present green, late amber, absent red. */
export function AttendancePill({ state, label }: { state: string; label: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-caption ${TONE_CLASS[tone(state)]}`}
    >
      {label}
    </span>
  );
}
