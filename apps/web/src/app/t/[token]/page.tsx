import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { TrackingClient } from '@/components/tracking/TrackingClient';
import { getTheme } from '@/lib/server-session';
import type { TrackingView } from '@/lib/tracking-types';

export const dynamic = 'force-dynamic';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tracking');
  // The link is private to the customer: keep it out of search engines.
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/** The customer's tracking page, opened from Shopify's shipping email. No sign in. */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('tracking');
  const res = await fetch(`${apiUrl}/track/${encodeURIComponent(token)}`, { cache: 'no-store' });
  const view = res.ok ? ((await res.json()) as TrackingView) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex items-center justify-between px-4 py-3">
        <Logo alt={t('brand')} />
        <PreferencesMenu theme={await getTheme()} />
      </div>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-12 pt-2">
        {view ? (
          <TrackingClient token={token} initial={view} />
        ) : (
          <p role="alert" className="rounded-lg border border-line bg-surface p-6 text-body">
            {res.status === 404 ? t('notFound') : t('unavailable')}
          </p>
        )}
      </main>
    </div>
  );
}
