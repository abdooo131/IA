import type { Prisma, PrismaClient } from '@prisma/client';
import { DEMO_MERCHANTS } from './demo/data';
import { MERCHANT as SAMPLE_MERCHANT } from './seed/data';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a start up switch (deploy/start.mjs, deploy/prepare.mjs) left behind:
 * - jobs_disabled: the API started with its background jobs off (no late flags, Shopify sync,
 *   emails, push, storage or cash deadline)
 * - fresh_start_done / fresh_start_wrong_word / fresh_start_refused: FRESH_START is still set
 * - demo_load_done: DEMO_LOAD is still set although the demo month is loaded
 * - demo_not_loaded: DEMO_LOAD is set but the demo month was not (and will not be) loaded
 */
export type StartupFlagState =
  | 'jobs_disabled'
  | 'fresh_start_done'
  | 'fresh_start_wrong_word'
  | 'fresh_start_refused'
  | 'demo_load_done'
  | 'demo_not_loaded';

/**
 * Raises one startup_flag admin alert per switch and state while it is open, so a switch left
 * on is seen on the alerts page and not only in the server log. Safe to run on every start.
 */
export async function raiseStartupAlert(db: Db, flag: string, state: StartupFlagState) {
  const open = await db.alert.findFirst({
    where: {
      type: 'startup_flag',
      resolvedAt: null,
      AND: [
        { data: { path: ['flag'], equals: flag } },
        { data: { path: ['state'], equals: state } },
      ],
    },
    select: { id: true },
  });
  if (open) return { raised: false };
  await db.alert.create({ data: { type: 'startup_flag', data: { flag, state } } });
  return { raised: true };
}

/** The merchants the seed and the demo month make up. */
export const SAMPLE_MERCHANT_NAMES = [SAMPLE_MERCHANT.name, ...DEMO_MERCHANTS.map((m) => m.name)];

/** Orders of merchants the seed and the demo month did not make: real business. */
export async function realOrderCount(db: Db) {
  return db.order.count({ where: { merchant: { name: { notIn: SAMPLE_MERCHANT_NAMES } } } });
}

/** True when the demo month was loaded here, or its merchants exist (a run that stopped). */
export async function holdsDemo(db: Db) {
  const [marker, merchant] = await Promise.all([
    db.auditLog.findFirst({ where: { action: 'demo.loaded' }, select: { id: true } }),
    db.merchant.findFirst({
      where: { name: { in: DEMO_MERCHANTS.map((m) => m.name) } },
      select: { id: true },
    }),
  ]);
  return Boolean(marker || merchant);
}
