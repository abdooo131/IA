import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ReturnStatusChip } from '@/components/returns/ReturnStatusChip';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { ReturnListItem } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function StoreReturnsPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const [rows, t] = await Promise.all([
    apiGet<ReturnListItem[]>(`/stores/${storeId}/returns`),
    getTranslations('returns'),
  ]);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <h1 className="mt-2 text-h2">{t('storeTitle')}</h1>
      {rows.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('storeEmpty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/store/${storeId}/returns/${r.id}`}
                className="block rounded-lg border border-line bg-surface p-4 shadow-sm active:bg-surface-raised"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-h3">{r.merchant.name}</span>
                  <ReturnStatusChip status={r.status} />
                </span>
                <span className="ltr-iso block text-body-sm font-bold">{r.reference}</span>
                <span className="block text-body-sm text-text-muted">
                  {t('pickedOf', { picked: r.pickedUnits, total: r.units })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
