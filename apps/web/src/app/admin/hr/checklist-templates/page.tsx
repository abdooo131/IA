import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { TemplatesEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ChecklistTemplateRow, DocumentTypeRow, PositionRow } from '@/lib/hr-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/** HR configuration: HR view reads it, HR manage changes it (docs/HR.md). */
export default async function ChecklistTemplatesPage() {
  const [rows, positions, types, profile, t] = await Promise.all([
    apiGet<ChecklistTemplateRow[]>('/hr/checklist-templates'),
    apiGet<PositionRow[]>('/hr/positions'),
    apiGet<DocumentTypeRow[]>('/hr/document-types'),
    getMyProfile(),
    getTranslations('people'),
  ]);
  return (
    <>
      <HrPageHeader title={t('templatesTitle')} intro={t('templatesIntro')} />
      <TemplatesEditor
        rows={rows}
        positions={positions}
        types={types}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
