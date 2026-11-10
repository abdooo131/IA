import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { formatEgp } from '@/lib/format';

export interface DocEntryRow {
  id: string;
  entry: string;
  kind: string;
  day: string;
  amount: number;
}

/** The journal entries a document booked (shown to accounting view), each opening its entry. */
export async function DocEntries({
  entries,
  anchor = 'entries',
}: {
  entries: DocEntryRow[];
  anchor?: string;
}) {
  if (entries.length === 0) return null;
  const [td, tf] = await Promise.all([getTranslations('documents'), getTranslations('finance')]);
  const th = 'px-3 py-2 text-label uppercase text-text-muted';
  return (
    <section
      id={anchor}
      className="scroll-mt-20 overflow-x-auto rounded-lg border border-line bg-surface"
      aria-label={td('smart.entries')}
    >
      <table className="w-full text-body-sm">
        <thead className="border-b border-line bg-surface-raised">
          <tr>
            <th className={`${th} text-start`}>{td('fields.entry')}</th>
            <th className={`${th} text-start`}>{td('fields.kind')}</th>
            <th className={`${th} text-end`}>{td('fields.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-line last:border-0">
              <td className="px-3 py-2">
                <Link href={`/finance/journal/${e.id}`} className="ltr-iso text-link">
                  {e.entry}
                </Link>
              </td>
              <td className="px-3 py-2">
                {tf.has(`kinds.${e.kind}`) ? tf(`kinds.${e.kind}`) : e.kind}
              </td>
              <td className="px-3 py-2 text-end">
                <span className="ltr-iso">{formatEgp(e.amount)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
