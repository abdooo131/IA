import { HttpException } from '@nestjs/common';
import { DomainError } from '@shiplynow/db';
import type { BulkOutcome } from '@shiplynow/shared';

/**
 * Runs a single record action for each id of a bulk action (list views): every record goes
 * through its own checks and its own transaction, so one refusal never stops the others. A
 * business refusal or a scope refusal (403, 404) becomes that row's error code.
 */
export async function eachRecord(
  ids: string[],
  run: (id: string) => Promise<unknown>,
): Promise<{ results: BulkOutcome[] }> {
  const results: BulkOutcome[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      await run(id);
      results.push({ id, ok: true });
    } catch (error) {
      if (error instanceof DomainError) results.push({ id, ok: false, error: error.code });
      else if (error instanceof HttpException && error.getStatus() < 500) {
        const body = error.getResponse() as { error?: string } | string;
        results.push({
          id,
          ok: false,
          error: typeof body === 'object' && body.error ? body.error : 'refused',
        });
      } else throw error;
    }
  }
  return { results };
}
