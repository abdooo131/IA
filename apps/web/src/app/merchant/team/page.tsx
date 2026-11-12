import { getTranslations } from 'next-intl/server';
import { type TeamMember, TeamManager } from '@/components/merchant/TeamManager';
import { apiGet, requireMerchantRight } from '@/lib/api-server';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** The merchant's own team: owners only (members get not found, as from the API). */
export default async function MerchantTeamPage() {
  await requireMerchantRight('owner');
  const [team, claims, t] = await Promise.all([
    apiGet<TeamMember[]>('/merchant/team'),
    getClaims(),
    getTranslations('merchant.team'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <TeamManager team={team} meId={claims?.sub ?? null} />
    </>
  );
}
