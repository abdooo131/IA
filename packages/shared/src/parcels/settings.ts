// Business values live in the settings table, editable by admin. These are the defaults.

export interface SettingDef {
  label: string;
  kind: 'int' | 'money' | 'bp' | 'time' | 'text' | 'weekdays' | 'choice' | 'date' | 'longtext';
  default: number | string | number[];
  /** For kind 'choice': the allowed values. */
  options?: readonly string[];
}

export const SETTINGS = {
  'promise.cutoff': {
    label: 'Daily cutoff: parcels entering after this time count from tomorrow',
    kind: 'time',
    default: '18:00',
  },
  'promise.weekend_days': {
    label: 'Days with no deliveries (0 Sunday, 5 Friday)',
    kind: 'weekdays',
    default: [5],
  },
  'delivery.max_attempts': {
    label: 'Delivery attempts before the parcel goes back to the merchant',
    kind: 'int',
    default: 3,
  },
  'fees.cod_fee_bp': { label: 'COD fee in basis points (100 = 1%)', kind: 'bp', default: 100 },
  'fees.cod_free_amount': {
    label: 'COD amount with no fee (piastres)',
    kind: 'money',
    default: 300000,
  },
  'fees.return_fee_bp': {
    label: 'Fee when a parcel goes back to the merchant, as basis points of shipping (6000 = 60%)',
    kind: 'bp',
    default: 6000,
  },
  'fees.payout_fee': {
    label: 'Cash out fee taken from each merchant payout (piastres)',
    kind: 'money',
    default: 0,
  },
  'tracking.prefix': { label: 'Tracking number prefix', kind: 'text', default: 'SHP' },
  'handover.alert_hours': {
    label:
      'Hours a parcel may wait between two teams before it shows as late on the handover check',
    kind: 'int',
    default: 4,
  },
  'agents.default_commission_bp': {
    label: 'Default agent commission in basis points (1000 = 10%), used when an agent has none',
    kind: 'bp',
    default: 1500,
  },
  'attendance.alert_after_minutes': {
    label: 'Minutes after shift start without a check in before the agent is alerted',
    kind: 'int',
    default: 30,
  },
  'attendance.replacement_minutes': {
    label: 'Minutes an agent has to send a replacement after saying someone is not coming',
    kind: 'int',
    default: 60,
  },
  'attendance.replacement_penalty': {
    label: 'Charged to the agent each time a replacement comes late or never (piastres)',
    kind: 'money',
    default: 0,
  },
  'pay.point_value': {
    label: 'Value of one courier point (piastres)',
    kind: 'money',
    default: 100,
  },
  'pay.points_delivery': {
    label: 'Points for each parcel delivered to a customer',
    kind: 'int',
    default: 20,
  },
  'pay.points_return': {
    label: 'Points for each parcel handed back to a merchant',
    kind: 'int',
    default: 10,
  },
  'pay.points_pickup_parcel': {
    label: 'Points for each picked up parcel received at the facility',
    kind: 'int',
    default: 2,
  },
  'pay.daily_bonus_parcels': {
    label: 'Deliveries in one day that earn the daily bonus (0 = no bonus)',
    kind: 'int',
    default: 40,
  },
  'pay.daily_bonus_points': { label: 'Points for the daily bonus', kind: 'int', default: 100 },
  'pay.freeze_days': {
    label: 'Days before courier earnings can be withdrawn',
    kind: 'int',
    default: 3,
  },
  'pay.pickup_paid_by': {
    label: 'Who pays pickup staff: the company directly, or their agent at month end',
    kind: 'choice',
    default: 'COMPANY',
    options: ['COMPANY', 'AGENT'],
  },
  'books.closed_through': {
    label: 'Books are closed through this date: nothing can be posted on or before it',
    kind: 'date',
    default: '',
  },
  'tax.vat_bp': {
    label: 'VAT rate in basis points (1400 = 14%). Our prices include it',
    kind: 'bp',
    default: 1400,
  },
  'company.name': { label: 'Company name on tax invoices', kind: 'longtext', default: 'Shiply' },
  'company.tax_id': { label: 'Company tax registration number', kind: 'longtext', default: '' },
  'company.address': {
    label: 'Company address on tax invoices',
    kind: 'longtext',
    default: 'Cairo, Egypt',
  },
  'company.activity_code': { label: 'ETA activity code', kind: 'longtext', default: '5320' },
  'company.item_code': {
    label: 'ETA item code for delivery services',
    kind: 'longtext',
    default: '',
  },
  'agents.advance_max_bp': {
    label: 'Share of the month so far an agent may take as an advance (5000 = 50%)',
    kind: 'bp',
    default: 5000,
  },
  'cash.courier_limit': {
    label: 'Most cash a courier may hold before an alert (piastres)',
    kind: 'money',
    default: 500000,
  },
  'cash.safe_limit': {
    label: 'Most cash a hub safe may hold before an alert (piastres)',
    kind: 'money',
    default: 5000000,
  },
  'lost.no_scan_hours': {
    label:
      'Hours a parcel may wait without a scan at a station (picked up, inbound, sorting, outbound) before it is searched for',
    kind: 'int',
    default: 2,
  },
  'lost.transit_hours': {
    label:
      'Hours a parcel may be on a truck or out with a courier without a scan before it is searched for',
    kind: 'int',
    default: 12,
  },
  'lost.search_hours': {
    label: 'Hours a parcel is searched for before operations are asked to confirm the loss',
    kind: 'int',
    default: 24,
  },
  'lost.compensation_cap': {
    label:
      'Most we pay a merchant for a lost or damaged parcel, before the shipping fee refund (piastres)',
    kind: 'money',
    default: 300000,
  },
  'qc.override_hours': {
    label: 'Hours operations have to cancel a quality ticket before its penalty applies',
    kind: 'int',
    default: 24,
  },
  'qc.appeal_hours': {
    label: 'Hours a courier or agent has to appeal a penalty',
    kind: 'int',
    default: 48,
  },
  'fraud.max_failed_per_day': {
    label: 'Failed attempts by one courier in a day that raise a fraud check',
    kind: 'int',
    default: 8,
  },
  'fees.open_package': {
    label: 'Fee when the customer may open the parcel before paying (piastres)',
    kind: 'money',
    default: 500,
  },
  'fees.exchange_bp': {
    label: 'Exchange surcharge as basis points of shipping (5000 = 50%)',
    kind: 'bp',
    default: 5000,
  },
  'messages.channel': {
    label: 'How customers get messages',
    kind: 'choice',
    default: 'WHATSAPP',
    options: ['WHATSAPP', 'SMS'],
  },
  'tracking.base_url': {
    label: 'Public tracking page address in messages',
    kind: 'longtext',
    default: 'https://track.shiply.example/t',
  },
  'delivery.code_required': {
    label: 'The receiver must give the code sent to their phone before the courier can hand over',
    kind: 'choice',
    default: 'ON',
    options: ['ON', 'OFF'],
  },
  'courier.ping_seconds': {
    label: 'Seconds between location updates from a working courier phone',
    kind: 'int',
    default: 60,
  },
  'pickups.auto_request': {
    label: 'Book a pickup automatically when a merchant creates parcels and has none booked',
    kind: 'choice',
    default: 'ON',
    options: ['ON', 'OFF'],
  },
  'shop.open': {
    label: 'Merchants can order packaging from the shop in their panel',
    kind: 'choice',
    default: 'ON',
    options: ['ON', 'OFF'],
  },
  'fees.packaging_delivery': {
    label: 'Delivery price of a packaging order, VAT included (piastres)',
    kind: 'money',
    default: 2000,
  },
  'shop.free_delivery_from': {
    label: 'Packaging orders from this amount are delivered free (piastres, 0 = never)',
    kind: 'money',
    default: 0,
  },
  'cash.shortage_alert': {
    label: 'Courier cash difference that raises an alert (piastres)',
    kind: 'money',
    default: 0,
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = {
  [K in SettingKey]: (typeof SETTINGS)[K]['default'] extends number
    ? number
    : (typeof SETTINGS)[K]['default'] extends string
      ? string
      : number[];
};

export function defaultSettings(): SettingValues {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTINGS)) out[key] = def.default;
  return out as SettingValues;
}
