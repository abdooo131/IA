import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { DomainError } from '@shiplynow/db';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a "from" or "to" query value. A plain day (YYYY-MM-DD) means a Cairo calendar day:
 * "from" starts at its midnight and "to" includes the whole day. Full ISO instants pass as is.
 */
export function parseBound(value: string | undefined, edge: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  if (DAY.test(value)) {
    if (!isCalendarDay(value)) throw new DomainError('invalid_date', 400);
    return cairoDayStart(edge === 'from' ? value : addDays(value, 1));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new DomainError('invalid_date', 400);
  return date;
}

/** A from/to range defaulting to the last `days` Cairo days including today. */
export function parseRange(from: string | undefined, to: string | undefined, now: Date, days = 7) {
  const today = cairoDay(now);
  const start = parseBound(from ?? addDays(today, -(days - 1)), 'from')!;
  const end = parseBound(to ?? today, 'to')!;
  if (end <= start) throw new DomainError('invalid_range', 400);
  if (end.getTime() - start.getTime() > 400 * 86_400_000)
    throw new DomainError('range_too_long', 400);
  return { from: start, to: end };
}
