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
