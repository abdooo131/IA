// Statuses change only along an allowed list.

export function defineMachine<S extends string>(allowed: Record<S, readonly S[]>) {
  return {
    can(from: S, to: S): boolean {
      return allowed[from].includes(to);
    },
    assert(from: S, to: S): void {
      if (!allowed[from].includes(to)) throw new Error(`Status cannot change from ${from} to ${to}`);
    },
  };
}
