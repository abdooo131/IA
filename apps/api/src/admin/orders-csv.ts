import type { OrderSummary } from '@shiplynow/db';

const COLUMNS = [
  'number',
  'status',
  'source',
  'merchant',
  'store',
  'placed_at_cairo',
  'promise_cairo',
  'delivered_at_cairo',
  'late_stage',
  'customer',
  'phone',
  'phone_flagged',
  'address',
  'payment',
  'units',
  'products_egp',
  'delivery_fee_egp',
  'cod_egp',
  'rider',
  'closed_reason',
  'items',
] as const;

const cairo = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function when(value: Date | string | null) {
  if (!value) return '';
  const p = Object.fromEntries(cairo.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Piastres to an EGP amount with two decimals, using integers only. */
export function egp(piastres: number) {
  const sign = piastres < 0 ? '-' : '';
  const abs = Math.abs(piastres);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function cell(value: string | number | boolean) {
  const text = String(value);
  // Quote anything with separators, and neutralise formula prefixes so Excel never runs them.
  // A plain number (also negative, like -60.42) stays a number Excel can add up.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Byte order mark: tells Excel the file is UTF-8 so Arabic names show correctly. */
const BOM = String.fromCharCode(0xfeff);

export function ordersCsv(orders: OrderSummary[]): string {
  const lines = [COLUMNS.join(',')];
  for (const o of orders) {
    const row: Record<(typeof COLUMNS)[number], string | number | boolean> = {
      number: o.number,
      status: o.status,
      source: o.source,
      merchant: o.merchant.name,
      store: o.darkStore.code,
      placed_at_cairo: when(o.placedAt),
      promise_cairo: when(o.slaDueAt),
      delivered_at_cairo: when(o.deliveredAt),
      late_stage: o.lateStage ?? '',
      customer: o.customerName,
      phone: o.customerPhone,
      phone_flagged: o.phoneFlagged,
      address: o.addressText,
      payment: o.paymentMethod,
      units: o.units,
      products_egp: egp(o.subtotalPiastres),
      delivery_fee_egp: egp(o.deliveryFeePiastres),
      cod_egp: egp(o.codAmountPiastres),
      rider: o.rider ? `${o.rider.name} (${o.rider.badge})` : '',
      closed_reason: o.closedReason ?? '',
      items: o.items
        .map(
          (i) =>
            `${i.sku} x${i.quantity - i.cancelledQty}${i.cancelledQty ? ` (-${i.cancelledQty})` : ''}`,
        )
        .join('; '),
    };
    lines.push(COLUMNS.map((c) => cell(row[c])).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
