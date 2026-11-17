import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from '@prisma/client';

// A controllable clock for the demo loader. The domain code stamps business times with
// `new Date()`, so while the loader runs `globalThis.Date` is a subclass whose no argument
// constructor and `Date.now()` answer the simulated time. Each store's work runs in its own
// async context (AsyncLocalStorage), so stores can be simulated side by side, each with its
// own time. The simulated time never passes the real current time.

const RealDate = globalThis.Date;
const context = new AsyncLocalStorage<{ ms: number }>();
let globalMs: number | null = null;
let installed = false;

/** The real current time, whatever the clock says. */
export const realNow = () => RealDate.now();

function current(): number {
  const store = context.getStore();
  // Each read moves the clock on by one millisecond, so rows written in one step keep
  // their order (order events, audit rows) without visibly changing the time.
  if (store) return Math.min(store.ms++, RealDate.now());
  if (globalMs !== null) return Math.min(globalMs++, RealDate.now());
  return RealDate.now();
}

class SimulatedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(current());
    else super(...(args as [string | number | Date]));
  }
  static override now() {
    return current();
  }
  // Dates made before the clock was installed are still dates.
  static override [Symbol.hasInstance](value: unknown) {
    return value instanceof RealDate;
  }
}

function checked(ms: number) {
  if (!Number.isFinite(ms)) throw new Error('demo clock: invalid time');
  if (ms > RealDate.now()) throw new Error('demo clock: the simulation cannot pass the real time');
  return ms;
}

export function installClock(startMs: number) {
  globalMs = checked(startMs);
  if (!installed) {
    globalThis.Date = SimulatedDate as unknown as DateConstructor;
    installed = true;
  }
}

export function restoreClock() {
  globalThis.Date = RealDate;
  installed = false;
  globalMs = null;
}

/** Moves the shared clock (used outside the per store contexts). */
export function setClock(ms: number) {
  globalMs = checked(ms);
}

/** The simulated time as a real Date (safe to keep after the clock is restored). */
export function simNow(): Date {
  return new RealDate(current());
}

/** Runs `fn` with its own clock, starting at `ms`; `advance` inside it moves only that clock. */
export function withClock<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return context.run({ ms: checked(ms) }, fn);
}

/** Sets the clock of the current context (or the shared clock outside one). */
export function setContextClock(ms: number) {
  const store = context.getStore();
  if (store) store.ms = checked(ms);
  else globalMs = checked(ms);
}

type FieldInfo = { createdOnly: string[]; updated: string[] };

/** Per model: fields filled with now() on create, and @updatedAt fields. */
function timestampFields(): Map<string, FieldInfo> {
  const map = new Map<string, FieldInfo>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const info: FieldInfo = { createdOnly: [], updated: [] };
    for (const f of model.fields) {
      if (f.isUpdatedAt) info.updated.push(f.name);
      else if (
        f.hasDefaultValue &&
        typeof f.default === 'object' &&
        f.default !== null &&
        'name' in f.default &&
        f.default.name === 'now'
      )
        info.createdOnly.push(f.name);
    }
    if (info.createdOnly.length || info.updated.length) {
      // The client names models in lower camel case (orderEvent), dmmf in Pascal case.
      map.set(model.name, info);
    }
  }
  return map;
}

/**
 * A client whose created and updated timestamps (filled by Prisma or the database, which
 * do not read the JavaScript clock) take the simulated time, so rows land on the day being
 * simulated. Explicit values from the domain code are kept.
 */
export function clockedClient(db: PrismaClient): PrismaClient {
  const fields = timestampFields();
  const stamp = (data: unknown, names: string[]) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const row = data as Record<string, unknown>;
    const now = new Date();
    for (const name of names) if (row[name] === undefined) row[name] = now;
    return row;
  };
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation: op, args, query }) {
          const info = model ? fields.get(model) : undefined;
          const operation = op as string;
          if (info) {
            const a = args as Record<string, unknown>;
            const onCreate = [...info.createdOnly, ...info.updated];
            if (operation === 'create') stamp(a.data, onCreate);
            else if (operation === 'createMany' || operation === 'createManyAndReturn') {
              if (Array.isArray(a.data)) for (const row of a.data) stamp(row, onCreate);
              else stamp(a.data, onCreate);
            } else if (operation === 'upsert') {
              stamp(a.create, onCreate);
              stamp(a.update, info.updated);
            } else if (operation === 'update' || operation === 'updateMany') {
              stamp(a.data, info.updated);
            }
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
