import { getTranslations } from 'next-intl/server';
import { BackLink } from '@/components/store/BackLink';
import { BinLabels } from '@/components/store/BinLabels';
import { apiGet } from '@/lib/api-server';
import type { BinWithItems } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function LabelsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [bins, t] = await Promise.all([
    apiGet<BinWithItems[]>(`/stores/${storeId}/bins`),
    getTranslations('store.labels'),
  ]);
  return (
    <>
      <div className="print:hidden">
        <BackLink href={`/store/${storeId}`} />
        <h1 className="mt-2 text-h2">{t('title')}</h1>
      </div>
      <BinLabels bins={bins.map((b) => ({ code: b.code, type: b.type }))} />
    </>
  );
}
