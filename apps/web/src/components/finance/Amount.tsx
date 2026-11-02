import { formatEgp } from '@/lib/format';

/** An EGP amount, kept left to right in Arabic, red when negative. */
export function Amount({ piastres, strong = false }: { piastres: number; strong?: boolean }) {
  // -0 (nothing taken off) shows as 0.00, never "-0.00".
  const value = piastres === 0 ? 0 : piastres;
  return (
    <span className={`ltr-iso ${strong ? 'font-bold' : ''} ${value < 0 ? 'text-danger' : ''}`}>
      {formatEgp(value)}
    </span>
  );
}
