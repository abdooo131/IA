// The hero's example order ticket replays one order: the minutes count up and each step lights
// in turn, ending at delivered. The page is rendered at the end state, so it is complete
// without JavaScript and for people who prefer less motion.

/** The minute each step starts: received, picked, packed, rider on the way, delivered. */
export const STEP_MINUTES = [0, 7, 11, 15, 47] as const;
/** The minute the order is delivered, where the ticket rests. */
export const FINAL_MINUTE = STEP_MINUTES[STEP_MINUTES.length - 1]!;
export const PROMISE_MINUTES = 60;

export interface StepState {
  done: boolean;
  now: boolean;
}

/** Which steps are done and which one is happening at minute `m`. */
export function stepStates(m: number): StepState[] {
  const last = STEP_MINUTES.length - 1;
  if (m >= FINAL_MINUTE) return STEP_MINUTES.map((_, i) => ({ done: i < last, now: i === last }));
  return STEP_MINUTES.map((start, i) => {
    const next = STEP_MINUTES[i + 1];
    return {
      done: m > start || (next !== undefined && m >= next),
      now: m >= start && (next === undefined || m < next),
    };
  });
}

/** How full the bar is at minute `m`, in percent of the 60 minute promise. */
export function barPercent(m: number): number {
  return Math.round((Math.min(m, PROMISE_MINUTES) / PROMISE_MINUTES) * 100);
}

/** A whole number in the page's digits: Arabic-Indic on the Arabic page. */
export function localDigits(n: number, locale: string): string {
  const text = String(n);
  return locale === 'ar' ? text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!) : text;
}
