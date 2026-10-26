import { formatEgp } from '@/lib/format';

/** An EGP amount, kept left to right in Arabic, red when negative. */
export function Amount({ piastres, strong = false }: { piastres: number; strong?: boolean }) {
  return (
    <span className={`ltr-iso ${strong ? 'font-bold' : ''} ${piastres < 0 ? 'text-danger' : ''}`}>
      {formatEgp(piastres)}
    </span>
  );
}
