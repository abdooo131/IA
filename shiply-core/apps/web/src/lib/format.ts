import { STATUS_LABELS, formatEgp, type ShipmentStatus } from '@shiply/shared';

export const egp = (piastres: number | null | undefined) => formatEgp(piastres ?? 0);

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

export function statusLabel(status: string, direction?: string): string {
  if (direction === 'RETURN' && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(status)) {
    return status === 'OUT_FOR_DELIVERY' ? 'Out for return' : `Returning · ${STATUS_LABELS[status as ShipmentStatus] ?? status}`;
  }
  return STATUS_LABELS[status as ShipmentStatus] ?? status;
}

export const STATUS_TONE: Record<string, string> = {
  CREATED: 'bg-slate-100 text-slate-700',
  PICKED_UP: 'bg-sky-100 text-sky-800',
  AT_HUB: 'bg-indigo-100 text-indigo-800',
  ON_HOLD: 'bg-amber-100 text-amber-800',
  IN_TRANSIT: 'bg-violet-100 text-violet-800',
  OUT_FOR_DELIVERY: 'bg-blue-100 text-blue-800',
  ATTEMPT_FAILED: 'bg-orange-100 text-orange-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  RETURNED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
  LOST: 'bg-red-200 text-red-900',
};

/** Simple CSV parser for uploads: handles quotes, commas and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
