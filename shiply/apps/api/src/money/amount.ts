import { z } from 'zod';
import { parseEgp } from '@shiply/shared';

/** An EGP amount from a form or the API, read the way people type it, as whole piastres. */
export const egp = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const p = parseEgp(v);
    if (p <= 0) throw new Error('positive');
    return p;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'amount' });
    return z.NEVER;
  }
});
