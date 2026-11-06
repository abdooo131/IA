import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DocumentTypesEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DepartmentRow, DocumentTypeRow, PositionRow } from '@/lib/hr-types';

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
      <h1 className="text-h2">{t('documentTypesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('documentTypesIntro')}</p>
      <DocumentTypesEditor
        rows={rows}
        departments={departments}
        positions={positions}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
