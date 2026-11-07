import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { SuggestionsList } from '@/components/hr/leave/SuggestionsList';
import { ViolationTabs } from '@/components/hr/leave/ViolationTabs';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { Suggestion } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** Suggested violations from closed attendance days, waiting for HR to confirm or dismiss. */
export default async function SuggestedViolationsPage() {
  const [rows, profile, t] = await Promise.all([
    apiGet<Suggestion[]>('/hr/violations/suggestions'),
    getMyProfile(),
    getTranslations('hr3'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('suggestedTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('suggestedIntro')}</p>
      <ViolationTabs current="suggested" suggested={rows.length} />
      <SuggestionsList rows={rows} canUse={canDo(profile, 'hr', 'use')} />
    </>
  );
}
