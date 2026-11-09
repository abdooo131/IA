import { z } from 'zod';
import { parseEgp } from '@shiply/shared';

/** A rate in EGP as typed (zero allowed), stored as piastres. */
export const rate = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const p = v === '' ? 0 : parseEgp(v);
    if (p < 0 || p > 100_000_000) throw new Error('range');
    return p;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'rate' });
    return z.NEVER;
  }
});
