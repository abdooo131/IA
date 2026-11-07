/** Piastres to an EGP amount with two decimals, Latin digits (kept LTR in Arabic). */
export function formatEgp(piastres: number): string {
  return (piastres / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Time of day in Cairo, HH:MM. */
export function formatCairoTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Date and time in Cairo, Latin digits, for tables and timelines. */
export function formatCairoDateTime(iso: string | Date, locale: string): string {
  return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The Cairo day a cutoff covers. Cutoffs are stored as the first moment of the next day,
 * so one millisecond earlier is the last moment of the day they include.
 */
export function formatCutoffDay(iso: string | Date, locale: string): string {
  return new Date(new Date(iso).getTime() - 1).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric' },
  );
}
