import { addDays } from '@shiplynow/shared';

/**
 * The first day the books are open: the day after they were closed through; null when no day
 * was ever closed. Forms offer days from it and refuse an earlier typed day before sending
 * (the API answers books_closed for them anyway).
 */
export function firstOpenDay(lock: { closedThrough: string } | null | undefined) {
  return lock ? addDays(lock.closedThrough, 1) : null;
}

/** Whether a YYYY-MM-DD day falls inside closed books. */
export function inClosedBooks(day: string, openFrom: string | null | undefined) {
  return !!openFrom && !!day && day < openFrom;
}
