import type { DealCard } from '@shiplynow/db';
import { daysInStage } from '@shiplynow/shared';
import { BOM, cell, egp, when } from '../admin/orders-csv';

const COLUMNS = [
  'number',
  'company',
  'source',
  'city',
  'owner',
  'stage',
  'days_in_stage',
  'expected_orders_month',
  'expected_fee_egp_month',
  'expected_close',
  'next_step',
  'next_step_cairo',
  'lost_reason',
  'created_cairo',
  'won_cairo',
  'lost_cairo',
] as const;

/** The deals list as CSV (house rules: UTF-8 byte order mark, formulas never run). */
export function dealsCsv(deals: DealCard[], now: Date = new Date()): string {
  const lines = [COLUMNS.join(',')];
  for (const d of deals) {
    const row: Record<(typeof COLUMNS)[number], string | number> = {
      number: d.label,
      company: d.company.brandName,
      source: d.company.source,
      city: d.company.city ?? '',
      owner: d.owner?.name ?? '',
      stage: d.stage,
      days_in_stage: daysInStage(d.stageChangedAt, now),
      expected_orders_month: d.expectedMonthlyOrders ?? '',
      expected_fee_egp_month:
        d.expectedMonthlyFeePiastres === null ? '' : egp(d.expectedMonthlyFeePiastres),
      expected_close: d.expectedCloseDate ?? '',
      next_step: d.nextStep?.subject ?? '',
      next_step_cairo: when(d.nextStep?.dueAt ?? null),
      lost_reason: d.lostReason ?? '',
      created_cairo: when(d.createdAt),
      won_cairo: when(d.wonAt),
      lost_cairo: when(d.lostAt),
    };
    lines.push(COLUMNS.map((c) => cell(row[c])).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
