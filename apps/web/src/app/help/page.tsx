import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { homeFor } from '@/lib/access';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const ROLES = ['store_staff', 'rider', 'merchant', 'finance', 'admin'] as const;
type SopRole = (typeof ROLES)[number];
interface Sop {
  title: string;
  who: string;
  day: string[];
  escalation: string[];
  sections: { title: string; steps: string[]; check: string[]; problems: string[] }[];
}

/** The SOP of the signed in user's role. Admins can read every role's. */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/help');
  const asked = (await searchParams).role as SopRole;
  const role: SopRole =
    user.role === 'admin' && ROLES.includes(asked) ? asked : (user.role as SopRole);
  const t = await getTranslations('sop');
  const sop = t.raw(`roles.${role}`) as Sop;
  const tab = (r: SopRole) =>
    `rounded-md px-3 py-2 text-body-sm font-bold ${r === role ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href={homeFor(user.role) ?? '/'} className="text-body-sm text-link">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-h2">{t('title')}</h1>
        <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
        {user.role === 'admin' && (
          <nav className="mt-4 flex flex-wrap gap-1" aria-label={t('others')}>
            {ROLES.map((r) => (
              <Link key={r} href={`/help?role=${r}`} className={tab(r)}>
                {t(`roles.${r}.title`)}
              </Link>
            ))}
          </nav>
        )}
        <article className="mt-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{sop.title}</h2>
          <p className="mt-1 text-body-sm text-text-muted">{sop.who}</p>
          <section className="mt-4 rounded-md bg-selected-bg p-3">
            <h3 className="text-body font-bold">{t('day')}</h3>
            <ul className="mt-1 list-disc space-y-1 ps-6 text-body-sm">
              {sop.day.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>
          <section className="mt-3 rounded-md border border-status-needs-action p-3">
            <h3 className="text-body font-bold">{t('escalation')}</h3>
            <ul className="mt-1 list-disc space-y-1 ps-6 text-body-sm">
              {sop.escalation.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>
          <h3 className="mt-5 text-h3">{t('tasks')}</h3>
          {sop.sections.map((s) => (
            <details key={s.title} className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-body font-bold">{s.title}</summary>
              <p className="mt-2 text-caption font-bold text-text-muted">{t('steps')}</p>
              <ol className="mt-1 list-decimal space-y-2 ps-6 text-body-sm">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3 text-caption font-bold text-text-muted">✓ {t('check')}</p>
              <ul className="mt-1 list-disc space-y-1 ps-6 text-body-sm">
                {s.check.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="mt-3 text-caption font-bold text-danger">! {t('problems')}</p>
              <ul className="mt-1 list-disc space-y-1 ps-6 text-body-sm">
                {s.problems.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          ))}
        </article>
      </main>
    </div>
  );
}
