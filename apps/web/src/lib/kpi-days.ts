import { addDays } from '@shiplynow/shared';

export interface DayCount {
  date: string;
  orders: number;
  delivered: number;
  onTime: number;
}

/** One entry per Cairo day from `from` to `to`, so quiet days show as zero instead of vanishing. */
export function fillDays(perDay: DayCount[], from: string, to: string, max = 92): DayCount[] {
  const days: DayCount[] = [];
  for (let d = from; d <= to && days.length < max; d = addDays(d, 1))
    days.push(perDay.find((x) => x.date === d) ?? { date: d, orders: 0, delivered: 0, onTime: 0 });
  return days;
}

/** 2026-10-27 as 27/10, the short label under a chart column. */
export function shortDay(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
