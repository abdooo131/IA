import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { RecordViolationForm } from '@/components/hr/leave/RecordViolationForm';
import { ViolationsTable } from '@/components/hr/leave/ViolationsTable';
import { ViolationTabs } from '@/components/hr/leave/ViolationTabs';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { Violation, ViolationType } from '@/lib/leave-types';
import { btnPrimary, HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/**
 * Violations (HR phase 3): every violation, those appealed, the final ones, and the deductions
 * of outsourced people to tell their company. HR use records one on the person's ladder.
 */
export default async function ViolationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const q = await searchParams;
  const current = (['appealed', 'final', 'supplier'] as const).find((s) => s === q.status) ?? 'all';
  const query =
    current === 'supplier' ? '?forSupplier=1' : current === 'all' ? '' : `?status=${current}`;
  const profile = await getMyProfile();
  const canUse = canDo(profile, 'hr', 'use');
  const [rows, types, people, badges, t] = await Promise.all([
    apiGet<Violation[]>(`/hr/violations${query}`),
    apiGet<ViolationType[]>('/hr/violations/types'),
    canUse
      ? apiGet<
          { id: string; code: string; nameEn: string; nameAr: string | null; status: string }[]
        >('/hr/employees')
      : Promise.resolve([]),
    apiTry<{ suggested: number }>('/me/hr-badges'),
    getTranslations('hr3'),
  ]);
  return (
    <>
      <HrPageHeader
        title={t('violationsTitle')}
        intro={t('violationsIntro')}
        actions={
          canUse && (
            <a href="#record" className={btnPrimary}>
              {t('recordViolation')}
            </a>
          )
        }
      />
      <ViolationTabs current={current} suggested={badges?.suggested ?? 0} />
      {current === 'supplier' && (
        <p className="mt-3 max-w-3xl text-body-sm">{t('supplierIntro')}</p>
      )}
      <ViolationsTable rows={rows} hrefBase="/admin/hr/violations" />
      {canUse && (
        <details
          id="record"
          className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface p-4"
        >
          <summary className="cursor-pointer text-h3">{t('recordViolation')}</summary>
          <RecordViolationForm
            types={types.filter((x) => x.isActive)}
            people={people.filter((p) => p.status !== 'left')}
            today={cairoDay(new Date())}
          />
        </details>
      )}
    </>
  );
}
