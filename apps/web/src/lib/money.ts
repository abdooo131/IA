/**
 * EGP typed by a person ("1,249.50", "-20") to integer piastres without going through a
 * float, or null when it is not a valid amount.
 */
export function parseEgp(text: string, { allowNegative = false } = {}): number | null {
  const clean = text.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match || (match[1] && !allowNegative)) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? 0 - value : value;
}
