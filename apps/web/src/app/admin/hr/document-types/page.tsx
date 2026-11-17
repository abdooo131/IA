import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DocumentTypesEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DepartmentRow, DocumentTypeRow, PositionRow } from '@/lib/hr-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/** HR configuration: HR view reads it, HR manage changes it (docs/HR.md). */
export default async function DocumentTypesPage() {
  const [rows, departments, positions, profile, t] = await Promise.all([
    apiGet<DocumentTypeRow[]>('/hr/document-types'),
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<PositionRow[]>('/hr/positions'),
    getMyProfile(),
    getTranslations('people'),
  ]);
  return (
    <>
      <HrPageHeader title={t('documentTypesTitle')} intro={t('documentTypesIntro')} />
      <DocumentTypesEditor
        rows={rows}
        departments={departments}
        positions={positions}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
