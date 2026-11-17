import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { ManifestListItem } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function ReceiveListPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const [manifests, t] = await Promise.all([
    apiGet<ManifestListItem[]>(`/stores/${storeId}/manifests`),
    getTranslations('store.receive'),
  ]);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <h1 className="mt-2 text-h2">{t('title')}</h1>
      {manifests.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {manifests.map((m) => (
            <li key={m.id}>
              <Link
                href={`/store/${storeId}/receive/${m.id}`}
                className="block rounded-lg border border-line bg-surface p-4 shadow-sm active:bg-surface-raised"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-h3">{m.merchant.name}</span>
                  <span className="text-caption text-text-muted">
                    {m.status === 'receiving' ? t('statusReceiving') : t('statusExpected')}
                  </span>
                </span>
                <span className="ltr-iso block text-body-sm font-bold">{m.reference}</span>
                <span className="block text-body-sm text-text-muted">
                  {t('units', { received: m.receivedUnits, expected: m.expectedUnits })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
