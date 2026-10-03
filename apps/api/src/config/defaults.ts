/**
 * Every business value lives in system_config. This file is only the seed catalogue of defaults;
 * at runtime values are always read from the database and edited from the ops admin panel.
 * Money: piastres. Points: integer points. Rates: basis points (10000 = 100%).
 */
export type ConfigType = 'int' | 'bool' | 'string' | 'json';

export interface ConfigDefault {
  key: string;
  value: unknown;
  type: ConfigType;
  category: string;
  description: string;
}

export const CONFIG_DEFAULTS: ConfigDefault[] = [
  // Pricing (spec 5)
  { key: 'pricing.base_price_cairo_giza', value: 8000, type: 'int', category: 'pricing', description: 'Base delivery price Cairo & Giza, Small/Medium, excl. VAT (piastres). Seeds the zone price table.' },
  { key: 'pricing.exchange_multiplier_bp', value: 12500, type: 'int', category: 'pricing', description: 'Exchange price multiplier vs Deliver (basis points, 12500 = 1.25x)' },
  { key: 'pricing.return_multiplier_bp', value: 10000, type: 'int', category: 'pricing', description: 'Return order price multiplier vs Deliver (basis points)' },
  { key: 'pricing.failed_delivery_rate_bp', value: 6000, type: 'int', category: 'pricing', description: 'Failed delivery charge as a share of shipping price (basis points, 6000 = 60%)' },
  { key: 'pricing.vat_rate_bp', value: 1400, type: 'int', category: 'pricing', description: 'VAT rate (basis points, 1400 = 14%)' },
  { key: 'pricing.cod_fee_threshold', value: 300000, type: 'int', category: 'pricing', description: 'COD fee applies above this COD amount (piastres)' },
  { key: 'pricing.cod_fee_rate_bp', value: 100, type: 'int', category: 'pricing', description: 'COD fee rate (basis points, 100 = 1%)' },
  { key: 'pricing.cod_fee_mode', value: 'excess', type: 'string', category: 'pricing', description: "'excess' = fee on the amount above the threshold, 'full' = fee on the whole COD once above threshold" },
  { key: 'pricing.open_package_fee', value: 700, type: 'int', category: 'pricing', description: 'Open package fee (piastres)' },
  { key: 'pricing.vat_applies_to_fees', value: true, type: 'bool', category: 'pricing', description: 'Apply VAT to COD and open package fees as well as shipping' },

  // Merchant finance (spec 5)
  { key: 'merchant.cashout_fee_bank', value: 1500, type: 'int', category: 'merchant_finance', description: 'Bank cashout flat fee (piastres)' },
  { key: 'merchant.cashout_fee_fawry_account_bp', value: 100, type: 'int', category: 'merchant_finance', description: 'Fawry account cashout fee (basis points)' },
  { key: 'merchant.cashout_fee_fawry_card_bp', value: 100, type: 'int', category: 'merchant_finance', description: 'Fawry Yellow Card cashout fee (basis points)' },
  { key: 'merchant.bank_details_lock_days', value: 15, type: 'int', category: 'merchant_finance', description: 'Bank details can be edited once every N days (enforced by a DB trigger)' },
  { key: 'merchant.default_cashout_frequency', value: 'WEEKLY', type: 'string', category: 'merchant_finance', description: 'Default cashout frequency for new merchants' },

  // Orders
  { key: 'orders.tracking_prefix', value: 'SHP', type: 'string', category: 'orders', description: 'Tracking number prefix' },
  { key: 'orders.csv_max_rows', value: 2000, type: 'int', category: 'orders', description: 'Maximum rows per CSV import' },
  { key: 'orders.max_cod_amount', value: 5000000, type: 'int', category: 'orders', description: 'Maximum COD per order (piastres)' },
  { key: 'orders.postpone_window_days', value: 5, type: 'int', category: 'orders', description: 'Customer can postpone within the next N days' },

  { key: 'tracking.public_base_url', value: 'http://localhost:3002/t/', type: 'string', category: 'orders', description: 'Public tracking link printed on labels and sent to customers' },

  // Auth
  { key: 'auth.access_token_ttl_seconds', value: 900, type: 'int', category: 'auth', description: 'JWT access token lifetime (seconds)' },
  { key: 'auth.refresh_token_ttl_days', value: 30, type: 'int', category: 'auth', description: 'Refresh token lifetime (days)' },

  // Routing / hubs (spec 7)
  { key: 'routing.road_factor_bp', value: 13000, type: 'int', category: 'routing', description: 'Road distance factor applied to straight line distance (basis points)' },
  { key: 'routing.google_fallback_after_failures', value: 5, type: 'int', category: 'routing', description: 'Use Google Directions after N failed in house routing attempts' },
  { key: 'routing.stop_buffer_minutes', value: 8, type: 'int', category: 'routing', description: 'Minutes added per stop in ETA' },
  { key: 'routing.eta_recalc_minutes', value: 10, type: 'int', category: 'routing', description: 'Recalculate ETA from driver GPS every N minutes' },
  { key: 'routing.eta_shift_notify_minutes', value: 30, type: 'int', category: 'routing', description: 'Notify customer when ETA shifts more than N minutes' },
  { key: 'routing.average_speed_kmh', value: 25, type: 'int', category: 'routing', description: 'Average urban speed for in house ETA' },
  { key: 'zones.max_hub_distance_km', value: 40, type: 'int', category: 'routing', description: 'A destination further than this from every last mile hub is flagged for manual assignment' },
  { key: 'hubs.manifest_cutoff_time', value: '18:00', type: 'string', category: 'hubs', description: 'Default daily manifest cut off time per hub' },
  { key: 'hubs.missing_scan_alert_minutes', value: 30, type: 'int', category: 'hubs', description: 'Alert when scanned out but not scanned in N minutes after expected arrival' },

  // Points (spec 9)
  { key: 'points.piastres_per_point', value: 10, type: 'int', category: 'points', description: '1 point = N piastres (10 = 0.10 EGP)' },
  { key: 'points.delivery.base', value: 200, type: 'int', category: 'points', description: 'Delivery driver: base per successful delivery' },
  { key: 'points.delivery.factor_on_time_checkin', value: 50, type: 'int', category: 'points', description: 'Delivery factor: checked in on time that day' },
  { key: 'points.delivery.factor_rated_4_plus', value: 50, type: 'int', category: 'points', description: 'Delivery factor: delivery rated 4 stars or more' },
  { key: 'points.delivery.factor_80pct_completed', value: 50, type: 'int', category: 'points', description: 'Delivery factor: 80% or more of daily orders completed' },
  { key: 'points.delivery.completion_threshold_bp', value: 8000, type: 'int', category: 'points', description: 'Daily completion threshold for the completion factor (basis points)' },
  { key: 'points.delivery.rating_bonus_5', value: 100, type: 'int', category: 'points', description: 'Rating bonus 5 stars' },
  { key: 'points.delivery.rating_bonus_4', value: 60, type: 'int', category: 'points', description: 'Rating bonus 4 stars' },
  { key: 'points.delivery.rating_bonus_3', value: 20, type: 'int', category: 'points', description: 'Rating bonus 3 stars' },
  { key: 'points.delivery.same_day_bonus', value: 150, type: 'int', category: 'points', description: 'Same day delivery bonus' },
  { key: 'points.delivery.same_day_bonus_enabled', value: false, type: 'bool', category: 'points', description: 'Feature flag: same day bonus' },
  { key: 'points.delivery.failed_penalty', value: 0, type: 'int', category: 'points', description: 'Penalty on failed delivery (default 0, no automatic penalty)' },
  { key: 'points.pickup.per_stop', value: 200, type: 'int', category: 'points', description: 'Pickup driver: per merchant stop (flat)' },
  { key: 'points.daily_on_time_checkin', value: 250, type: 'int', category: 'points', description: 'Daily on time check in (both driver types)' },
  { key: 'points.streak_5_day', value: 500, type: 'int', category: 'points', description: '5 day on time streak' },
  { key: 'points.full_month_no_late', value: 1500, type: 'int', category: 'points', description: 'Full month with no late check in' },
  { key: 'penalties.late_checkin', value: 100, type: 'int', category: 'penalties', description: 'Late check in penalty' },
  { key: 'penalties.late_checkin_grace_minutes', value: 15, type: 'int', category: 'penalties', description: 'Late after N minutes' },
  { key: 'penalties.no_show', value: 400, type: 'int', category: 'penalties', description: 'No show penalty' },
  { key: 'penalties.missed_pickup_stop', value: 100, type: 'int', category: 'penalties', description: 'Missed pickup stop penalty' },
  { key: 'penalties.fake_update_1', value: 500, type: 'int', category: 'penalties', description: 'QC confirmed fake update: 1st offence (+ warning)' },
  { key: 'penalties.fake_update_2', value: 1000, type: 'int', category: 'penalties', description: 'QC confirmed fake update: 2nd within window (+ suspension review)' },
  { key: 'penalties.fake_update_window_days', value: 30, type: 'int', category: 'penalties', description: 'Window for repeated fake update offences' },

  // Wallet (spec 9.5, 9.6)
  { key: 'wallet.pending_days', value: 3, type: 'int', category: 'wallet', description: 'Earnings stay PENDING for N days' },
  { key: 'wallet.min_cashout_points', value: 2000, type: 'int', category: 'wallet', description: 'Minimum available points to cash out' },
  { key: 'franchise.commission_bp', value: 1500, type: 'int', category: 'wallet', description: 'Franchise earns this share on top of its drivers earnings (basis points)' },

  // QC (spec 10.1)
  { key: 'qc.override_window_hours', value: 24, type: 'int', category: 'qc', description: 'Fake flag override window' },
  { key: 'qc.appeal_window_hours', value: 48, type: 'int', category: 'qc', description: 'Driver appeal window' },
  { key: 'qc.gps_trail_minutes', value: 60, type: 'int', category: 'qc', description: 'GPS trail shown around an update (total minutes)' },

  // Notifications (spec 10.2)
  { key: 'notify.open_package_merchant_reply_hours', value: 2, type: 'int', category: 'notify', description: 'Merchant has N hours to approve opening before paying' },

  // Fraud (spec 11.2)
  { key: 'fraud.deposit_tolerance_bp', value: 500, type: 'int', category: 'fraud', description: 'Deposit vs expected tolerance (basis points)' },
  { key: 'fraud.checkin_distance_m', value: 500, type: 'int', category: 'fraud', description: 'Check in GPS distance from start location' },
  { key: 'fraud.max_deliveries_per_shift', value: 60, type: 'int', category: 'fraud', description: 'Max deliveries in one shift' },
  { key: 'fraud.receipt_time_tolerance_hours', value: 2, type: 'int', category: 'fraud', description: 'Receipt time allowed outside shift' },

  // Webhooks (spec 11.4)
  { key: 'webhooks.retry_schedule_seconds', value: [60, 300, 1800, 7200, 86400], type: 'json', category: 'integrations', description: 'Outbound webhook retry delays, then dead letter' },
];
