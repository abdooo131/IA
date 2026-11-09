import { z } from 'zod';
import { parseEgp } from '@shiply/shared';

/** Amounts are stored as 32 bit integers: 20 million EGP is the most one line can hold. */
export const MAX_PIASTRES = 2_000_000_000;

/** An EGP amount from a form or the API, read the way people type it, as whole piastres. */
export const egp = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const p = parseEgp(v);
    if (p <= 0 || p > MAX_PIASTRES) throw new Error('range');
    return p;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'amount' });
    return z.NEVER;
  }
});
