// Business values live in the settings table, editable by admin. These are the defaults.

export interface SettingDef {
  label: string;
  kind: 'int' | 'money' | 'bp' | 'time' | 'text' | 'weekdays';
  default: number | string | number[];
}

export const SETTINGS = {
  'promise.cutoff': { label: 'Daily cutoff: parcels entering after this time count from tomorrow', kind: 'time', default: '18:00' },
  'promise.weekend_days': { label: 'Days with no deliveries (0 Sunday, 5 Friday)', kind: 'weekdays', default: [5] },
  'delivery.max_attempts': { label: 'Delivery attempts before the parcel goes back to the merchant', kind: 'int', default: 3 },
  'fees.cod_fee_bp': { label: 'COD fee in basis points (100 = 1%)', kind: 'bp', default: 100 },
  'fees.cod_free_amount': { label: 'COD amount with no fee (piastres)', kind: 'money', default: 300000 },
  'fees.return_fee_bp': { label: 'Return fee as basis points of shipping (5000 = 50%)', kind: 'bp', default: 5000 },
  'tracking.prefix': { label: 'Tracking number prefix', kind: 'text', default: 'SHP' },
  'handover.alert_hours': { label: 'Hours a parcel may wait between two teams before it shows as late on the handover check', kind: 'int', default: 4 },
  'agents.default_commission_bp': { label: 'Default agent commission in basis points (1000 = 10%), used when an agent has none', kind: 'bp', default: 1000 },
  'attendance.alert_after_minutes': { label: 'Minutes after shift start without a check in before the agent is alerted', kind: 'int', default: 30 },
  'attendance.replacement_minutes': { label: 'Minutes an agent has to send a replacement after saying someone is not coming', kind: 'int', default: 60 },
  'cash.shortage_alert': { label: 'Courier cash difference that raises an alert (piastres)', kind: 'money', default: 0 },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = { [K in SettingKey]: (typeof SETTINGS)[K]['default'] extends number ? number : (typeof SETTINGS)[K]['default'] extends string ? string : number[] };

export function defaultSettings(): SettingValues {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTINGS)) out[key] = def.default;
  return out as SettingValues;
}
