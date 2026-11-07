import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BackLink } from '@/components/store/BackLink';
import { TransferRoute } from '@/components/transfers/TransferRoute';
import { TransferStatusChip } from '@/components/transfers/TransferStatusChip';
import { apiGet } from '@/lib/api-server';
import type { TransferListItem } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

export default async function StoreTransfersPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const [lists, t] = await Promise.all([
    apiGet<{ outgoing: TransferListItem[]; incoming: TransferListItem[] }>(
      `/stores/${storeId}/transfers`,
    ),
    getTranslations('transfers'),
  ]);
  const section = (heading: string, rows: TransferListItem[], empty: string, incoming: boolean) => (
    <section className="mt-5">
      <h2 className="text-h3">{heading}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/store/${storeId}/transfers/${r.id}`}
                className="block rounded-lg border border-line bg-surface p-4 shadow-sm active:bg-surface-raised"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="ltr-iso text-h3">{r.reference}</span>
                  <TransferStatusChip status={r.status} />
                </span>
                <span className="block text-body-sm">
                  <TransferRoute from={r.from} to={r.to} finalDestination={r.finalDestination} />
                </span>
                <span className="block text-body-sm text-text-muted">
                  {incoming
                    ? t('toReceive', { count: r.pickedUnits })
                    : t('pickedOf', { picked: r.pickedUnits, total: r.units })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <h1 className="mt-2 text-h2">{t('storeTitle')}</h1>
      {section(t('incoming'), lists.incoming, t('noIncoming'), true)}
      {section(t('outgoing'), lists.outgoing, t('noOutgoing'), false)}
    </>
  );
}
