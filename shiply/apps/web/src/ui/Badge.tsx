import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'new' | 'progress' | 'heading' | 'delivered' | 'needs' | 'returning';

/** A soft coloured status badge with a dot, the same everywhere in the system. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>;
}

/** Which colour a parcel status speaks in. */
export function parcelTone(status: string): Tone {
  if (status === 'delivered') return 'delivered';
  if (status === 'out_for_delivery') return 'heading';
  if (['attempt_failed', 'on_hold'].includes(status)) return 'needs';
  if (['returned', 'lost', 'cancelled'].includes(status)) return 'returning';
  if (status === 'created') return 'new';
  return 'progress';
}
