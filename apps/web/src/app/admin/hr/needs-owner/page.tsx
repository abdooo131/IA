import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { EmptyState, HrPageHeader } from '@/components/hr/HrPage';
import { NeedsOwnerList } from '@/components/hr/NeedsOwnerList';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { NeedsOwnerRow, OwnerCandidates } from '@/lib/hr-phase2';

export const dynamic = 'force-dynamic';

/** HR phase 2: what leavers looked after that still needs a new owner. */
export default async function NeedsOwnerPage() {
  const [data, profile, t] = await Promise.all([
    apiGet<{ rows: NeedsOwnerRow[]; candidates: OwnerCandidates }>('/hr/reassignments'),
    getMyProfile(),
    getTranslations('hr2'),
  ]);
  return (
    <>
      <HrPageHeader title={t('needsOwner.title')} intro={t('needsOwner.intro')} />
      {data.rows.length === 0 ? (
        <EmptyState title={t('needsOwner.empty')} body={t('needsOwner.emptyBody')} icon="account" />
      ) : (
        <NeedsOwnerList
          rows={data.rows}
          candidates={data.candidates}
          canManage={canDo(profile, 'hr', 'manage')}
        />
      )}
    </>
  );
}
