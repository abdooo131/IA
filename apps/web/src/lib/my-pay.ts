/** A month YYYY-MM in words in the page's language ("November 2026", "نوفمبر 2026"). */
export function formatMonth(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** A day YYYY-MM-DD as dd/mm/yyyy (the house date format, whatever the language). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}
