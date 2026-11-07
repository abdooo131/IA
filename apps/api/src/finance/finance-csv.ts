import { egp } from '../admin/orders-csv';

const BOM = String.fromCharCode(0xfeff);

function cell(value: string | number | null) {
  const text = value === null ? '' : String(value);
  // A plain number (also negative, like -60.42) stays a number Excel can add up.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const cairo = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function cairoStamp(value: Date | string) {
  const p = Object.fromEntries(cairo.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A CSV for Excel: UTF-8 with a byte order mark, formulas neutralised, amounts in EGP. */
export function csv(header: string[], rows: (string | number | null)[][]) {
  return `${BOM}${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export { egp };
