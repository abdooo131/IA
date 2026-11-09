import type { PrismaClient } from '@shiply/db';
import { SETTING_DEFAULTS } from '../settings/settings.service';
import { handler } from './registry';

async function retryMinutes(db: PrismaClient): Promise<number[]> {
  const row = await db.setting.findUnique({ where: { key: 'events.retry_minutes' } });
  return (row?.value ?? SETTING_DEFAULTS['events.retry_minutes']) as number[];
}

/** Delivers one event to one handler, or records the failure. Safe with several workers. */
async function deliverOne(db: PrismaClient, eventId: string, name: string, now: Date) {
  try {
    await db.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<{ event_id: string }[]>`
          SELECT event_id FROM platform.event_deliveries
          WHERE event_id = ${eventId} AND handler = ${name} AND status = 'pending' AND next_at <= ${now}
          FOR UPDATE SKIP LOCKED`;
        if (claimed.length === 0) return;
        const ev = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
        const fn = handler(ev.type, name);
        if (!fn) throw new Error(`No handler "${name}" for ${ev.type}`);
        await fn(ev.payload, tx);
        await tx.eventDelivery.update({
          where: { eventId_handler: { eventId, handler: name } },
          data: { status: 'done', attempts: { increment: 1 }, lastError: null },
        });
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    const retry = await retryMinutes(db);
    const d = await db.eventDelivery.findUnique({ where: { eventId_handler: { eventId, handler: name } } });
    if (!d || d.status !== 'pending') return;
    const attempts = d.attempts + 1;
    const wait = retry[attempts - 1];
    await db.eventDelivery.update({
      where: { eventId_handler: { eventId, handler: name } },
      data: {
        attempts,
        lastError: String(err instanceof Error ? err.message : err).slice(0, 2000),
        ...(wait === undefined ? { status: 'dead' } : { nextAt: new Date(now.getTime() + wait * 60_000) }),
      },
    });
  }
}

/** Delivers every delivery that is due. Returns how many were tried. */
export async function processDue(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await db.eventDelivery.findMany({
    where: { status: 'pending', nextAt: { lte: now } },
    select: { eventId: true, handler: true },
    orderBy: { nextAt: 'asc' },
    take: 100,
  });
  for (const d of due) await deliverOne(db, d.eventId, d.handler, now);
  return due.length;
}

/** Runs processDue every few seconds until stopped. */
export function startEventWorker(db: PrismaClient, everyMs = 2000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processDue(db)
      .catch((err) => console.error('event worker', err))
      .finally(() => (running = false));
  }, everyMs);
  return () => clearInterval(timer);
}
