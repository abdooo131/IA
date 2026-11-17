/** Failed polls in a row before a screen says its connection is lost (screen behaviour, not a business value). */
export const CONNECTION_LOST_AFTER = 3;

/** The count of failed polls in a row after one more poll. */
export function nextFailures(failures: number, ok: boolean): number {
  return ok ? 0 : failures + 1;
}

export function connectionLost(failures: number): boolean {
  return failures >= CONNECTION_LOST_AFTER;
}
