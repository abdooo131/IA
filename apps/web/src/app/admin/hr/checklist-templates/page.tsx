import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { TemplatesEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ChecklistTemplateRow, DocumentTypeRow, PositionRow } from '@/lib/hr-types';

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
      <h1 className="text-h2">{t('templatesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('templatesIntro')}</p>
      <TemplatesEditor
        rows={rows}
        positions={positions}
        types={types}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
