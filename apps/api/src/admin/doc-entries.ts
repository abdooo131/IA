import type { DocSmartButton } from '@shiplynow/shared';
import { entryNumber } from '@shiplynow/shared';
import type { PrismaService } from '../prisma/prisma.service';

/** A journal entry a document booked, for its document page. */
export interface DocEntry {
  id: string;
  entry: string;
  kind: string;
  day: string;
  amount: number;
}

/**
 * The journal entries a document booked (their idempotency keys start with the document's
 * prefix, as `manifest:<id>:` or `return:<id>:`) and the smart button that opens them: the
 * entry itself when there is one, else the list on the page (#lines).
 */
export async function documentEntries(
  prisma: PrismaService,
  keyPrefix: string,
): Promise<{ entries: DocEntry[]; button: DocSmartButton }> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { idempotencyKey: { startsWith: keyPrefix } },
    select: {
      id: true,
      number: true,
      kind: true,
      occurredAt: true,
      lines: { select: { amountPiastres: true } },
    },
    orderBy: { number: 'asc' },
  });
  const entries = rows.map((e) => ({
    id: e.id,
    entry: entryNumber(e.number),
    kind: e.kind,
    day: e.occurredAt.toISOString(),
    amount: e.lines.reduce((s, l) => s + Math.max(0, l.amountPiastres), 0),
  }));
  return {
    entries,
    button: {
      key: 'entries',
      count: entries.length,
      href: entries.length === 1 ? `/finance/journal/${entries[0]!.id}` : '#entries',
    },
  };
}
