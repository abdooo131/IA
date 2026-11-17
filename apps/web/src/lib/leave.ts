import type { PenaltyKind } from '@shiplynow/shared';

// Small rules the HR phase 3 screens share (docs/HR.md "Phase 3 as built"); kept apart from the
// components so they are tested on their own.

/** Days as people write them: 2, 1.5, 0.25 (never 2.00). */
export function fmtDays(days: number): string {
  return String(Math.round(days * 100) / 100);
}

/** The pill tone of a request, violation or correction status. */
export function statusTone(status: string): 'delivered' | 'needs-action' | 'new' | 'danger' {
  if (['approved', 'applied', 'final', 'paid'].includes(status)) return 'delivered';
  if (['rejected', 'cancelled', 'dismissed'].includes(status)) return 'danger';
  if (
    [
      'pending_manager',
      'pending_hr',
      'pending_accounting',
      'appealed',
      'open',
      'recorded',
    ].includes(status)
  )
    return 'needs-action';
  return 'new';
}

/** The month before or after YYYY-MM. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Friday and Saturday: the Egyptian weekend, shaded on the calendar. */
export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 5 || weekday === 6;
}

/** The message key and values that describe a ladder step's penalty. */
export function penaltyWords(p: {
  penalty: PenaltyKind;
  days: number | null;
  amountPiastres: number | null;
}): { key: string; values: Record<string, string> } {
  if (p.penalty === 'deduction_days' || p.penalty === 'suspension_days')
    return { key: p.penalty, values: { days: fmtDays(p.days ?? 0) } };
  if (p.penalty === 'deduction_amount')
    return p.amountPiastres == null
      ? { key: 'deduction_amount_entered', values: {} }
      : {
          key: 'deduction_amount',
          values: { amount: (p.amountPiastres / 100).toFixed(2) },
        };
  return { key: p.penalty, values: {} };
}

/** HH:MM in Cairo of an instant (proposed correction times). */
export function cairoClock(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Whole and half days of a balance, never below zero for display of what is left. */
export function leftText(available: number | null): string {
  if (available === null) return '';
  return fmtDays(Math.max(0, available));
}
