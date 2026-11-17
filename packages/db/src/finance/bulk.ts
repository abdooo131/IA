import type { BulkOutcome } from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import { approvePayout, decideFinanceRequest, payoutNeedsApproval } from './controls';

// Bulk actions of the list views. Each record still goes through the single record rule (the
// second person rule, never one's own request, a reason to reject, the approval limit), one
// transaction per record, so one refusal never stops the others.

const outcome = async (id: string, run: () => Promise<unknown>): Promise<BulkOutcome> => {
  try {
    await run();
    return { id, ok: true };
  } catch (error) {
    if (error instanceof DomainError) return { id, ok: false, error: error.code };
    throw error;
  }
};

/** Approves or rejects several waiting requests; a rejection needs its note. */
export async function bulkDecideRequests(
  db: Db,
  input: { ids: string[]; approve: boolean; note?: string; actorUserId: string },
) {
  const results: BulkOutcome[] = [];
  for (const id of [...new Set(input.ids)])
    results.push(
      await outcome(id, () =>
        decideFinanceRequest(db, {
          requestId: id,
          approve: input.approve,
          note: input.note,
          actorUserId: input.actorUserId,
        }),
      ),
    );
  return { results };
}

/**
 * Approves several draft payouts. Only payouts at or above the approval limit need it, so a
 * payout below the limit is refused (approval_not_needed) rather than marked approved.
 */
export async function bulkApprovePayouts(db: Db, input: { ids: string[]; actorUserId: string }) {
  const results: BulkOutcome[] = [];
  for (const id of [...new Set(input.ids)])
    results.push(
      await outcome(id, async () => {
        const payout = await db.payout.findUnique({ where: { id } });
        if (!payout) throw new DomainError('payout_not_found', 404);
        if (payout.status === 'draft' && !(await payoutNeedsApproval(db, payout.amountPiastres)))
          throw new DomainError('approval_not_needed');
        return approvePayout(db, { payoutId: id, actorUserId: input.actorUserId });
      }),
    );
  return { results };
}
