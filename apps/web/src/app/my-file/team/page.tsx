import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { TeamPanel } from '@/components/hr/TeamPanel';
import { apiGet } from '@/lib/api-server';
import type { TeamData } from '@/lib/hr-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** A manager's team (direct and indirect), from My HR. Files open without pay. */
export default async function MyTeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/my-file/team');
  if (user.role === 'merchant') redirect('/merchant');
  const [team, t] = await Promise.all([apiGet<TeamData>('/me/team'), getTranslations('people')]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <Link href="/my-file" className="text-body-sm text-link">
          {t('backMyHr')}
        </Link>
        <h1 className="mt-2 text-h2">{t('myTeam')}</h1>
        <p className="mt-1 text-body-sm text-text-muted">{t('myTeamIntro')}</p>
        <TeamPanel team={team} hrefBase="/my-file/team" />
      </main>
    </div>
  );
}
