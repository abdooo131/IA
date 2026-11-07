import { z } from 'zod';

const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
const count = z.number().int().min(0).max(100_000);
/** Money in piastres (integer, never a float) */
const piastres = z.number().int().min(0).max(100_000_000);
/** A percentage in basis points: 250 means 2.5% */
const basisPoints = z.number().int().min(0).max(10_000);
/** Yearly salary amounts can pass 1,000,000 EGP */
const yearlyPiastres = z.number().int().min(0).max(2_000_000_000);

/**
 * Every configurable business value, with its default (CLAUDE.md rule 6). Values live in
 * the settings table and are edited from admin; the defaults are only used until then.
 * scope "global" applies everywhere; a dark store id overrides it for that store.
 */
export const SETTING_DEFINITIONS = {
  'sla.accept_minutes': {
    schema: minutes,
    default: 2,
    description: 'Minutes from order arrival until the store accepts it',
    override: 'store',
  },
  'sla.pick_minutes': {
    schema: minutes,
    default: 10,
    description: 'Minutes from acceptance until every item is picked',
    override: 'store',
  },
  'sla.pack_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from picked until packed',
    override: 'store',
  },
  'sla.handover_minutes': {
    schema: minutes,
    default: 5,
    description: 'Minutes from packed until handed to a rider',
    override: 'store',
  },
  'sla.ride_minutes': {
    schema: minutes,
    default: 35,
    description: 'Minutes from hand over until delivered',
    override: 'store',
  },
  'sla.promise_minutes': {
    schema: minutes,
    default: 60,
    description: 'Delivery time promised to the customer',
    override: 'store',
  },
  'stock.buffer_units': {
    schema: count,
    default: 0,
    description: 'Units per SKU and store held back from what Shopify can sell',
    override: 'store',
  },
  'stock.low_stock_threshold': {
    schema: count,
    default: 5,
    description: 'Available units at or below which admin shows a low stock alert',
    override: 'store',
  },
  'delivery.max_orders_per_trip': {
    schema: z.number().int().min(1).max(5),
    default: 2,
    description:
      'Most orders one rider may carry in one trip, when all of them stay inside the SLA',
    override: 'store',
  },
  'delivery.max_attempts': {
    schema: z.number().int().min(1).max(5),
    default: 2,
    description: 'Delivery attempts per order before it finally fails',
    override: 'store',
  },
  'delivery.retry_hold_hours': {
    schema: z.number().int().min(1).max(168),
    default: 48,
    description: 'Hours a failed attempt waits for a retry decision before the order finally fails',
    override: 'store',
  },
  'delivery.return_alert_minutes': {
    schema: minutes,
    default: 120,
    description:
      'Minutes after a failed attempt before admin is alerted that the goods are not back',
    override: 'store',
  },
  'delivery.min_calls_no_answer': {
    schema: z.number().int().min(0).max(5),
    default: 2,
    description:
      'Calls the rider must make from the app before reporting that the customer did not answer',
    override: 'store',
  },
  'tracking.rider_ping_seconds': {
    schema: z.number().int().min(5).max(300),
    default: 20,
    description: 'Seconds between rider position updates while an order is out for delivery',
    override: 'store',
  },
  'tracking.rider_stale_minutes': {
    schema: z.number().int().min(1).max(60),
    default: 5,
    description:
      'Minutes after which the customer map hides a rider position that stopped updating',
    override: 'store',
  },
  'tracking.low_rating_stars': {
    schema: z.number().int().min(0).max(5),
    default: 2,
    description:
      'Customer ratings at or below this many stars raise an admin alert (0 turns it off)',
    override: 'none',
  },
  'refill.default_min_units': {
    schema: count,
    default: 5,
    description:
      'A store is refilled when a product falls below this many units (product value wins)',
    override: 'store',
  },
  'refill.default_max_units': {
    schema: count,
    default: 20,
    description: 'Refills fill a store up to this many units of a product (product value wins)',
    override: 'store',
  },
  'refill.run_hour': {
    schema: z.number().int().min(0).max(23),
    default: 21,
    description: 'Cairo hour after which the daily automatic refill drafts are prepared',
    override: 'none',
  },
  'refill.enabled': {
    schema: z.number().int().min(0).max(1),
    default: 1,
    description: 'Prepare automatic refill drafts every day (1 on, 0 off)',
    override: 'none',
  },
  'finance.approval_threshold_piastres': {
    schema: piastres,
    default: 1_000_000,
    description:
      'Payouts, expenses and drawings from this amount (piastres) need a second person to approve them; 0 turns it off',
    override: 'none',
  },
  'finance.approve_money_in': {
    schema: z.number().int().min(0).max(1),
    default: 1,
    description:
      'Owner capital, other income, merchant payments to us and merchant balance changes wait for a second person (1) or post at once (0)',
    override: 'none',
  },
  'payroll.tax_band_1_to_piastres': {
    schema: yearlyPiastres,
    default: 4000000,
    description:
      'Salary income tax: band 1 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_1_bp': {
    schema: basisPoints,
    default: 0,
    description: 'Salary income tax rate of band 1, in basis points',
    override: 'none',
  },
  'payroll.tax_band_2_to_piastres': {
    schema: yearlyPiastres,
    default: 5500000,
    description:
      'Salary income tax: band 2 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_2_bp': {
    schema: basisPoints,
    default: 1000,
    description: 'Salary income tax rate of band 2, in basis points',
    override: 'none',
  },
  'payroll.tax_band_3_to_piastres': {
    schema: yearlyPiastres,
    default: 7000000,
    description:
      'Salary income tax: band 3 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_3_bp': {
    schema: basisPoints,
    default: 1500,
    description: 'Salary income tax rate of band 3, in basis points',
    override: 'none',
  },
  'payroll.tax_band_4_to_piastres': {
    schema: yearlyPiastres,
    default: 20000000,
    description:
      'Salary income tax: band 4 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_4_bp': {
    schema: basisPoints,
    default: 2000,
    description: 'Salary income tax rate of band 4, in basis points',
    override: 'none',
  },
  'payroll.tax_band_5_to_piastres': {
    schema: yearlyPiastres,
    default: 40000000,
    description:
      'Salary income tax: band 5 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_5_bp': {
    schema: basisPoints,
    default: 2250,
    description: 'Salary income tax rate of band 5, in basis points',
    override: 'none',
  },
  'payroll.tax_band_6_to_piastres': {
    schema: yearlyPiastres,
    default: 120000000,
    description:
      'Salary income tax: band 6 covers yearly taxable income up to this amount (piastres)',
    override: 'none',
  },
  'payroll.tax_band_6_bp': {
    schema: basisPoints,
    default: 2500,
    description: 'Salary income tax rate of band 6, in basis points',
    override: 'none',
  },
  'payroll.tax_top_bp': {
    schema: basisPoints,
    default: 2750,
    description: 'Salary income tax rate above the last band, in basis points',
    override: 'none',
  },
  'payroll.tax_skip_1_from_piastres': {
    schema: yearlyPiastres,
    default: 60000000,
    description:
      'Above this yearly taxable income, bands 1 to 1 are taxed at the rate of band 2 (0 turns it off)',
    override: 'none',
  },
  'payroll.tax_skip_2_from_piastres': {
    schema: yearlyPiastres,
    default: 70000000,
    description:
      'Above this yearly taxable income, bands 1 to 2 are taxed at the rate of band 3 (0 turns it off)',
    override: 'none',
  },
  'payroll.tax_skip_3_from_piastres': {
    schema: yearlyPiastres,
    default: 80000000,
    description:
      'Above this yearly taxable income, bands 1 to 3 are taxed at the rate of band 4 (0 turns it off)',
    override: 'none',
  },
  'payroll.tax_skip_4_from_piastres': {
    schema: yearlyPiastres,
    default: 90000000,
    description:
      'Above this yearly taxable income, bands 1 to 4 are taxed at the rate of band 5 (0 turns it off)',
    override: 'none',
  },
  'payroll.tax_skip_5_from_piastres': {
    schema: yearlyPiastres,
    default: 120000000,
    description:
      'Above this yearly taxable income, bands 1 to 5 are taxed at the rate of band 6 (0 turns it off)',
    override: 'none',
  },
  'finance.corporate_tax_bp': {
    schema: basisPoints,
    default: 2250,
    description: 'Company income tax on the year profit, in basis points (2250 is 22.5%)',
    override: 'none',
  },
  'payroll.personal_exemption_piastres': {
    schema: yearlyPiastres,
    default: 2_000_000,
    description: 'Yearly personal exemption before salary income tax (piastres)',
    override: 'none',
  },
  'payroll.si_employee_bp': {
    schema: basisPoints,
    default: 1100,
    description: 'Social insurance paid by the employee, share of the insured wage (basis points)',
    override: 'none',
  },
  'payroll.si_employer_bp': {
    schema: basisPoints,
    default: 1875,
    description: 'Social insurance paid by the company, share of the insured wage (basis points)',
    override: 'none',
  },
  'payroll.si_min_wage_piastres': {
    schema: piastres,
    default: 270_000,
    description: 'Lowest monthly insured wage (piastres)',
    override: 'none',
  },
  'payroll.si_max_wage_piastres': {
    schema: piastres,
    default: 1_670_000,
    description: 'Highest monthly insured wage (piastres)',
    override: 'none',
  },
  'payroll.martyrs_fund_bp': {
    schema: basisPoints,
    default: 5,
    description: 'Martyrs fund deducted from gross salary (basis points; 5 is 0.05%)',
    override: 'none',
  },
  'fee.order_fixed_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Fixed fee per delivered order (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.order_percent_bp': {
    schema: basisPoints,
    default: 0,
    description:
      'Fee per delivered order as a share of the products value (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.cod_percent_bp': {
    schema: basisPoints,
    default: 0,
    description:
      'COD handling fee as a share of the cash collected (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.failed_delivery_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Fee when a delivery fails and the goods come back (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.receiving_per_unit_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Fee per unit received from a merchant shipment (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.storage_per_unit_month_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Storage fee per unit per month, charged daily on units in stock (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'fee.return_per_unit_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Fee per unit returned to the merchant from a dark store (standard price; a merchant contract may set its own)',
    override: 'none',
  },
  'finance.payout_minimum_piastres': {
    schema: piastres,
    default: 0,
    description:
      'Payouts wait until we owe a merchant at least this (standard; a contract may set its own)',
    override: 'none',
  },
  'fee.vat_bp': {
    schema: basisPoints,
    default: 0,
    description: 'VAT added to our fees, in basis points (1400 is 14%)',
    override: 'none',
  },
  'rider.bonus_per_delivery_piastres': {
    schema: piastres,
    default: 0,
    description: 'Bonus a rider earns per delivered order, in piastres',
    override: 'store',
  },
  'store.capacity_orders_per_hour': {
    schema: count,
    default: 20,
    description: 'Orders a store accepts per hour before it stops offering 60 minute delivery',
    override: 'store',
  },
  'push.enabled': {
    schema: z.number().int().min(0).max(1),
    default: 1,
    description:
      'Phone and browser notifications are sent (1) or not (0); they also need the VAPID keys',
    override: 'none',
  },
  'signup.auto_approve': {
    schema: z.number().int().min(0).max(1),
    default: 1,
    description:
      'New merchants who sign up are approved at once (1) or wait for admin approval (0)',
    override: 'none',
  },
  'sales.auto_assign': {
    schema: z.number().int().min(0).max(1),
    default: 0,
    description:
      'New leads wait unassigned for the sales manager (0) or go round robin to the active sales reps (1)',
    override: 'none',
  },
  'sales.overdue_minutes': {
    schema: minutes,
    default: 60,
    description:
      'Minutes a sales follow up may stay open after it was due before its owner and the sales managers are alerted',
    override: 'none',
  },
  'sales.stale_days': {
    schema: z.number().int().min(1).max(365),
    default: 14,
    description:
      'Days a deal may sit in one stage before it is flagged as stale (one alert per stage)',
    override: 'none',
  },
  'sales.proposal_valid_days': {
    schema: z.number().int().min(1).max(365),
    default: 14,
    description: 'Days a sent proposal stays open for the brand to accept before it expires',
    override: 'none',
  },
  'sales.max_discount_bp': {
    schema: basisPoints,
    default: 2000,
    description:
      'Largest discount a rep may offer on any fee against the fee settings without a sales manager approving the proposal first (basis points: 2000 is 20%)',
    override: 'none',
  },
  'sales.commission_bp': {
    schema: basisPoints,
    default: 500,
    description:
      'Commission to a rep who hit their monthly fees target, as a share of all the fees counted for them that month (basis points: 500 is 5%)',
    override: 'none',
  },
  'sales.commission_months': {
    schema: z.number().int().min(0).max(60),
    default: 12,
    description:
      'Months a won merchant counts for its rep, the month the deal was won counting as the first (0: no end)',
    override: 'none',
  },
  'sales.qualify_active_months': {
    schema: z.number().int().min(1).max(12),
    default: 2,
    description:
      'Distinct months with at least one delivered order a won merchant needs before its fees count for its rep (from the month it reaches them on)',
    override: 'none',
  },
  'sales.setup_link_days': {
    schema: z.number().int().min(1).max(90),
    default: 7,
    description: "Days a new merchant owner's one time link to choose a password stays valid",
    override: 'none',
  },
  'ticket.normal_answer_minutes': {
    schema: minutes,
    default: 120,
    description:
      'Minutes a normal ticket may wait for its first answer before both people are told',
    override: 'none',
  },
  'ticket.urgent_answer_minutes': {
    schema: minutes,
    default: 30,
    description:
      'Minutes an urgent ticket may wait for its first answer before both people are told',
    override: 'none',
  },
  'ticket.read_reminder_minutes': {
    schema: minutes,
    default: 15,
    description:
      'Minutes after which the assignee is reminded once if they have not opened the ticket',
    override: 'none',
  },
  'customer.new_days': {
    schema: count,
    default: 30,
    description: 'A customer whose first order is this recent counts as new',
    override: 'none',
  },
  'customer.at_risk_days': {
    schema: count,
    default: 60,
    description: 'A customer with no order for this many days counts as at risk',
    override: 'none',
  },
  'customer.lost_days': {
    schema: count,
    default: 180,
    description: 'A customer with no order for this many days counts as lost',
    override: 'none',
  },
  'customer.vip_orders': {
    schema: count,
    default: 5,
    description: 'A customer with at least this many orders counts as VIP',
    override: 'none',
  },
  'customer.late_factor_pct': {
    schema: count,
    default: 150,
    description:
      'A repeat customer should have ordered again once this share of their usual gap has passed (150 means one and a half gaps)',
    override: 'none',
  },
  'customer.at_risk_value_pct': {
    schema: count,
    default: 50,
    description:
      "Share of an at risk customer's usual yearly spend counted in the 12 month forecast",
    override: 'none',
  },
  'customer.budget_index_pct': {
    schema: count,
    default: 80,
    description:
      'A customer whose items cost below this share of the usual price in their categories buys budget',
    override: 'none',
  },
  'customer.premium_index_pct': {
    schema: count,
    default: 125,
    description:
      'A customer whose items cost above this share of the usual price in their categories buys premium',
    override: 'none',
  },
  'customer.risk_min_attempts': {
    schema: count,
    default: 3,
    description: 'Delivery attempts needed before a customer gets a cash on delivery risk level',
    override: 'none',
  },
  'customer.risk_medium_pct': {
    schema: count,
    default: 20,
    description: 'Failed attempts (refusals count double) at or above this share mean medium risk',
    override: 'none',
  },
  'customer.risk_high_pct': {
    schema: count,
    default: 40,
    description:
      'Failed attempts (refusals count double) at or above this share mean high risk; new cash orders from them raise an alert',
    override: 'none',
  },
  'hr.document_alert_days': {
    schema: z.number().int().min(1).max(365),
    default: 30,
    description:
      'Days before an employee document runs out when HR gets one document expiring alert',
    override: 'none',
  },
  'hr.probation_months': {
    schema: z.number().int().min(0).max(12),
    default: 3,
    description: 'Months of probation filled in for a new employee from the hire date',
    override: 'none',
  },
  'hr.clock_radius_m': {
    schema: z.number().int().min(10).max(5_000),
    default: 150,
    description: 'Metres from the store (or the office) inside which a phone may clock in or out',
    override: 'store',
  },
  'hr.max_accuracy_m': {
    schema: z.number().int().min(5).max(5_000),
    default: 100,
    description:
      'A clock in is refused when the phone position is less accurate than this (metres)',
    override: 'none',
  },
  'hr.late_grace_minutes': {
    schema: minutes,
    default: 10,
    description:
      'Minutes after the shift start (or before its end) that do not count as late or left early',
    override: 'none',
  },
  'hr.overtime_after_minutes': {
    schema: minutes,
    default: 30,
    description: 'Work past the shift end counts as overtime only from this many minutes',
    override: 'none',
  },
  'hr.auto_close_hours': {
    schema: z.number().int().min(1).max(12),
    default: 4,
    description:
      'Hours after the shift end when a day is closed; a person still clocked in is clocked out at the shift end and flagged',
    override: 'none',
  },
  'hr.riders_must_clock_in': {
    schema: z.number().int().min(0).max(1),
    default: 0,
    description: '1: a rider who is not clocked in cannot be handed orders',
    override: 'store',
  },
  'hr.default_annual_leave_days': {
    schema: z.number().int().min(0).max(60),
    default: 21,
    description:
      'Annual leave days a year when neither the position nor the grade sets them (HR confirms the legal minimum, more after 10 years or age 50)',
    override: 'none',
  },
  'hr.casual_leave_days': {
    schema: z.number().int().min(0).max(30),
    default: 6,
    description: 'Casual leave days a year; they come off the annual balance',
    override: 'none',
  },
  'hr.leave_year_start_month': {
    schema: z.number().int().min(1).max(12),
    default: 1,
    description: 'Month the leave year starts (1 is January: the calendar year)',
    override: 'none',
  },
  'hr.leave_accrual_monthly': {
    schema: z.number().int().min(0).max(1),
    default: 0,
    description:
      '0: the year’s annual leave is granted at its start; 1: it is earned month by month',
    override: 'none',
  },
  'hr.leave_carry_over_days': {
    schema: z.number().int().min(0).max(60),
    default: 0,
    description: 'Unused annual leave days carried into the next leave year (at most)',
    override: 'none',
  },
  'hr.leave_backdate_days': {
    schema: z.number().int().min(0).max(60),
    default: 7,
    description: 'How many days back a leave request may start (HR may go further)',
    override: 'none',
  },
  'hr.payroll_days_per_month': {
    schema: z.number().int().min(20).max(31),
    default: 30,
    description:
      'A day of pay is the basic salary divided by this (unpaid leave and deductions in days)',
    override: 'none',
  },
  'hr.violation_period_days': {
    schema: z.number().int().min(1).max(730),
    default: 180,
    description:
      'Violations of the same type inside this many days climb the penalty ladder; older ones no longer count',
    override: 'none',
  },
  'hr.appeal_days': {
    schema: z.number().int().min(0).max(30),
    default: 3,
    description:
      'Days a person has to appeal a violation; without an appeal it becomes final after them',
    override: 'none',
  },
  // HR phase 2 (docs/HR.md "Phase 2 as built"): the hire and leaving wizards.
  'hr.setup_link_days': {
    schema: z.number().int().min(1).max(90),
    default: 7,
    description: "Days a new hire's one time link to choose a password stays valid",
    override: 'none',
  },
  'hr.notice_days': {
    schema: z.number().int().min(0).max(180),
    default: 30,
    description:
      'Notice period (days) the leaving wizard checks between the notice and the last working day',
    override: 'none',
  },
  'hr.pay_unused_leave_on_exit': {
    schema: z.number().int().min(0).max(1),
    default: 1,
    description:
      '1: unused annual leave days are paid in the final settlement; 0: they are not paid',
    override: 'none',
  },
  'finance.rider_cash_limit_piastres': {
    schema: piastres,
    default: 500_000,
    description:
      'Most cash (piastres) a rider may hold, counting the cash on delivery of the orders they carry; handing over a cash order past it needs a store manager (0 turns it off)',
    override: 'store',
  },
  'finance.rider_cash_max_hours': {
    schema: z.number().int().min(1).max(168),
    default: 12,
    description:
      'Hours a rider may keep collected cash before it is overdue (one alert per rider and day)',
    override: 'store',
  },
  'finance.rider_cash_warn_hours': {
    schema: z.number().int().min(1).max(168),
    default: 4,
    description: 'Cash position: rider cash older than this many hours shows as getting old',
    override: 'none',
  },
  'finance.petty_cash_limit_piastres': {
    schema: piastres,
    default: 50_000,
    description:
      'Petty cash above this amount (piastres) waits for finance to approve it (0 turns the amount check off)',
    override: 'store',
  },
  'finance.petty_cash_float_piastres': {
    schema: piastres,
    default: 100_000,
    description:
      'Cash (piastres) a store box keeps; a petty expense that would leave less waits for finance',
    override: 'store',
  },
  'hr.office_lat': {
    schema: z.number().min(-90).max(90),
    default: 0,
    description: 'Latitude of the company office where office staff clock in (0: not set)',
    override: 'none',
  },
  'hr.office_lng': {
    schema: z.number().min(-180).max(180),
    default: 0,
    description: 'Longitude of the company office where office staff clock in (0: not set)',
    override: 'none',
  },
  'stock.packaging_low_units': {
    schema: z.number().int().min(0).max(1_000_000),
    default: 50,
    description:
      'A packaging item (bags, boxes, labels) at or below this many units in a store raises a packaging_low alert; 0 turns it off',
    override: 'store',
  },
  'finance.po_bill_tolerance_bp': {
    schema: z.number().int().min(0).max(10_000),
    default: 200,
    description:
      'A bill made from a purchase order may be at most this share (basis points: 200 is 2%) above the ordered prices of what was received',
    override: 'none',
  },
} as const satisfies Record<
  string,
  {
    schema: z.ZodType<number>;
    default: number;
    description: string;
    /** Which per scope value is allowed besides the global one */
    override: 'store' | 'none';
  }
>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export const GLOBAL_SCOPE = 'global';

/**
 * The settings scope merchant fee values used before merchant contracts v2 (their prices now
 * live in the contract; the migration moved them and deleted the rows).
 */
export function merchantScope(merchantId: string) {
  return `merchant:${merchantId}`;
}

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}
