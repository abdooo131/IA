import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { SetupPasswordForm } from '@/components/sales/SetupPasswordForm';
import { getTheme } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('setupPage');
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * A new merchant owner chooses their password through the one time link the rep gave them
 * when the proposal was confirmed (docs/SALES.md 8). No sign in.
 */
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('setupPage');
  const res = await fetch(`${apiUrl}/auth/setup/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const who = res.ok
    ? ((await res.json()) as { name: string; email: string; merchant: string | null })
    : null;
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Logo alt={t('brand')} />
        <PreferencesMenu theme={await getTheme()} />
      </div>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-12 pt-6">
        {who ? (
          <SetupPasswordForm token={token} who={who} />
        ) : (
          <p role="alert" className="rounded-lg border border-line bg-surface p-6 text-body">
            {t('invalid')}
          </p>
        )}
      </main>
    </div>
  );
}
