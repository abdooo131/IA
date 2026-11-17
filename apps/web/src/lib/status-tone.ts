/**
 * The color family of a document status, so every list and document page shows the same
 * status in the same color (brand v2: the status color as text on a 14% tint of itself).
 *  - done: the document reached its good end (paid, posted, cleared, approved by the bank...)
 *  - progress: moving along (approved, issued, deposited, signed, ordered...)
 *  - waiting: someone has to act (pending, open, requested, draft waiting for approval...)
 *  - stopped: refused or broken (rejected, bounced, invalid, failed)
 *  - neutral: ended without money moving, or not in use (cancelled, reversed, inactive...)
 */
export type StatusTone = 'done' | 'progress' | 'waiting' | 'stopped' | 'neutral';

const TONES: Record<string, StatusTone> = {
  // done
  paid: 'done',
  posted: 'done',
  cleared: 'done',
  received: 'done',
  balanced: 'done',
  settled: 'done',
  valid: 'done',
  delivered: 'done',
  collected: 'done',
  closed: 'done',
  won: 'done',
  applied: 'done',
  final: 'done',
  active: 'done',
  hit: 'done',
  // progress
  approved: 'progress',
  issued: 'progress',
  deposited: 'progress',
  signed: 'progress',
  submitted: 'progress',
  ordered: 'progress',
  billed: 'progress',
  answered: 'progress',
  in_transit: 'progress',
  picking: 'progress',
  accepted: 'progress',
  packed: 'progress',
  ready: 'progress',
  receiving: 'progress',
  out_for_delivery: 'progress',
  // waiting for someone
  pending: 'waiting',
  awaiting_approval: 'waiting',
  open: 'waiting',
  requested: 'waiting',
  pending_manager: 'waiting',
  pending_hr: 'waiting',
  pending_accounting: 'waiting',
  not_sent: 'waiting',
  draft: 'waiting',
  expected: 'waiting',
  stale: 'waiting',
  attempt_failed: 'waiting',
  missed: 'waiting',
  // refused or broken
  rejected: 'stopped',
  bounced: 'stopped',
  invalid: 'stopped',
  failed: 'stopped',
  written_off: 'stopped',
  charged_to_rider: 'stopped',
  lost: 'stopped',
  // ended or not in use
  cancelled: 'neutral',
  reversed: 'neutral',
  inactive: 'neutral',
  superseded: 'neutral',
  no_target: 'neutral',
  new: 'neutral',
};

/** The tone of a status; unknown statuses are neutral. */
export function statusTone(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

/** The text color class of each tone (the pill's tint is mixed from the same color). */
export const TONE_TEXT: Record<StatusTone, string> = {
  done: 'text-status-delivered',
  progress: 'text-status-in-progress',
  waiting: 'text-status-needs-action',
  stopped: 'text-status-returning',
  neutral: 'text-status-new',
};

/** A pill: the status color as text on a 14% tint of itself (tokens.test.ts checks contrast). */
export function statusPillClass(status: string, tone?: StatusTone): string {
  return `inline-flex items-center whitespace-nowrap rounded-pill bg-[color-mix(in_srgb,currentColor_14%,transparent)] px-2.5 py-0.5 text-caption font-bold ${TONE_TEXT[tone ?? statusTone(status)]}`;
}
