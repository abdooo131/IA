import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ContractCalculator } from '@/components/contracts/ContractCalculator';
import { ContractDocument, ContractStanding } from '@/components/contracts/ContractDocument';
import { PrintLinks, VersionHistory } from '@/components/contracts/ContractTab';
import { apiGet } from '@/lib/api-server';
import { type ContractView, shownVersion } from '@/lib/contracts';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

/**
 * The merchant's own contract, read only: the version in force as a document, one agreed for
 * later, earlier versions, the calculator and the printed copy in English or Arabic.
 */
export default async function MerchantContractPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>;
}) {
  const { version } = await searchParams;
  const [view, t] = await Promise.all([
    apiGet<ContractView>('/merchant/contract'),
    getTranslations('contracts'),
  ]);
  const shown = shownVersion(view, version);
  const pdfHref = '/api/merchant/contract/pdf';
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-h2">{view.contract?.label ?? t('title')}</h1>
          <p className="text-body-sm text-text-muted">{t('readOnly')}</p>
          {version && shown && (
            <Link href="/merchant/contract" className="text-body-sm text-link">
              {t('backToCurrent')}
            </Link>
          )}
        </div>
        {shown && <PrintLinks href={pdfHref} version={version ? shown.id : undefined} />}
      </div>
      {view.scheduled.length > 0 && !version && (
        <p className="mt-4 rounded-lg border border-line bg-surface p-3 text-body-sm">
          {t('scheduledNote', {
            label: view.scheduled[0]!.label,
            day: isoToDayFirst(view.scheduled[0]!.effectiveFrom!),
          })}{' '}
          <Link
            href={`/merchant/contract?version=${view.scheduled[0]!.id}`}
            className="font-bold text-link"
          >
            {t('versions.view')}
          </Link>
        </p>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {shown ? (
          <ContractDocument view={view} version={shown} internal={false} />
        ) : (
          <p className="rounded-lg border border-dashed border-line bg-surface p-4 text-body-sm">
            {t('noContractMerchant')}
          </p>
        )}
        <div className="space-y-4">
          <ContractStanding view={view} internal={false} />
          <ContractCalculator version={shown} view={view} />
          <VersionHistory
            view={view}
            hrefBase="/merchant/contract?version="
            pdfHref={pdfHref}
            selectedId={version}
            internal={false}
          />
        </div>
      </div>
    </>
  );
}
