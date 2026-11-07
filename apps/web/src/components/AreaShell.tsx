import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/server-session';
import { AppHeader } from './AppHeader';

type AreaKey = 'store' | 'rider';

/** Placeholder frame for each area until its real screens arrive in later steps. */
export async function AreaShell({ area }: { area: AreaKey }) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/${area}`);

  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <p className="text-caption text-text-muted">
          {t('common.signedInAs', { name: user.name })} · {t(`roles.${user.role}`)}
        </p>
        <h1 className="mt-1 text-h2">{t(`areas.${area}.title`)}</h1>
        <section className="mt-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <p className="text-body">{t(`areas.${area}.description`)}</p>
          <p className="mt-2 text-body-sm text-text-muted">{t('common.comingSoon')}</p>
        </section>
      </main>
    </div>
  );
}
