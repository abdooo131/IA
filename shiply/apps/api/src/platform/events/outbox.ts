import { randomUUID } from 'node:crypto';
import type { Tx } from '@shiply/db';
import { handlersFor } from './registry';

/**
 * Announces that something happened. Written in the caller's transaction, so an event exists only
 * if the change it describes was saved. The same key twice is ignored.
 */
export async function publish(tx: Tx, type: string, payload: object, key: string): Promise<void> {
  const id = randomUUID();
  const { count } = await tx.outboxEvent.createMany({ data: [{ id, type, payload: payload as never, key }], skipDuplicates: true });
  if (count === 0) return;
  const names = handlersFor(type);
  if (names.length) {
    await tx.eventDelivery.createMany({ data: names.map((handler) => ({ eventId: id, handler })) });
  }
}
