import type { ReactNode } from 'react';
import { statusPillClass, type StatusTone } from '@/lib/status-tone';

/**
 * A document status as a colored pill (brand v2: the status color on a 14% tint of itself).
 * The tone comes from the raw status (lib/status-tone.ts) unless the caller gives one; the
 * label is always the translated word.
 */
export function StatusPill({
  status,
  tone,
  children,
  className = '',
}: {
  status: string;
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`${statusPillClass(status, tone)} ${className}`}>{children}</span>;
}
