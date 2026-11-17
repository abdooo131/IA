import { isoToDayFirst } from './day-first';
import { formatCairoDateTime, formatEgp } from './format';

// How the History panel (RecordHistory) words an audit row: the action in plain words, each
// changed field by its name, money in EGP, shares in percent, days day first, and never a raw
// id. Kept apart from the component so it can be tested.

/** Fields holding money in piastres whose name does not end in Piastres. */
const MONEY_FIELDS = new Set([
  'amount',
  'total',
  'vat',
  'net',
  'gross',
  'paid',
  'fee',
  'fees',
  'balance',
  'deduction',
  'deductions',
  'owed',
  'left',
  'cod',
  'counted',
  'expected',
  'difference',
  'heldPart',
  'price',
  'withholding',
]);

/** A field that only holds an internal id (the record it names is shown elsewhere). */
export const isIdField = (key: string) => key === 'id' || /Ids?$/.test(key);

/** A value an internal id would take (cuid or uuid). */
const looksLikeId = (v: string) =>
  /^c[a-z0-9]{20,}$/.test(v) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Whether a value can be shown: plain values only, no ids, no lists, nothing very long. */
export function readableValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'object') return false;
  const s = String(v);
  return !looksLikeId(s) && s.length <= 80;
}

/** "request_create" → "Request create"; "amountPiastres" → "Amount". */
export function humanise(text: string): string {
  const words = text
    .replace(/Piastres$/, '')
    .replace(/Bp$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : text;
}

/** An audit action without a translation, in plain words: "finance.request_create" → "Finance: request create". */
export function humaniseAction(action: string): string {
  const [entity, ...rest] = action.split('.');
  const what = rest.join(' ').replace(/_/g, ' ').trim();
  const who = humanise(entity ?? action);
  return what ? `${who}: ${what}` : who;
}

export const isMoneyField = (key: string) => /Piastres$/.test(key) || MONEY_FIELDS.has(key);
export const isShareField = (key: string) => /Bp$/.test(key);

/** One value of a changed field as a reader expects it. `state` words a status. */
export function formatHistoryValue(
  key: string,
  v: unknown,
  opts: { locale: string; yes: string; no: string; state: (s: string) => string },
): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? opts.yes : opts.no;
  if (typeof v === 'number' && Number.isInteger(v) && isMoneyField(key))
    return `${formatEgp(v)} EGP`;
  if (typeof v === 'number' && isShareField(key)) return `${v / 100}%`;
  const s = String(v);
  if ((key === 'status' || /Status$/.test(key)) && /^[a-z_]+$/.test(s)) return opts.state(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoToDayFirst(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return formatCairoDateTime(s, opts.locale);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s.slice(5)}/${s.slice(0, 4)}`;
  return s;
}
