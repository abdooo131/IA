/** Under an hour a ticking "2:58 min"; then "3 h 12 min"; past a day "4 days 11 h". */
export function durationParts(ms: number): {
  key: 'durationDays' | 'durationHours' | 'durationMinutes';
  vars: Record<string, string | number>;
} {
  const total = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  if (d > 0) return { key: 'durationDays', vars: { d, h } };
  if (h > 0) return { key: 'durationHours', vars: { h, m } };
  return { key: 'durationMinutes', vars: { m, ss } };
}
