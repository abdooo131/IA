import type { Tx } from '@shiply/db';

export type EventHandler = (payload: unknown, tx: Tx) => Promise<void>;

/** type → handler name → handler. Handler names are stable: deliveries are stored by name. */
const handlers = new Map<string, Map<string, EventHandler>>();

/** A module reacts to an event. The handler runs inside a transaction with the delivery mark. */
export function onEvent(type: string, handlerName: string, fn: EventHandler) {
  if (!handlers.has(type)) handlers.set(type, new Map());
  handlers.get(type)!.set(handlerName, fn);
}

export function handlersFor(type: string): string[] {
  return [...(handlers.get(type)?.keys() ?? [])];
}

export function handler(type: string, name: string): EventHandler | undefined {
  return handlers.get(type)?.get(name);
}

/** Tests only. */
export function clearHandlers() {
  handlers.clear();
}
