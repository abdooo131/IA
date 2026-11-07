import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { TicketsInbox } from '@/components/tickets/TicketsInbox';
import { homeFor } from '@/lib/access';
import { apiGet } from '@/lib/api-server';
import { getCurrentUser } from '@/lib/server-session';
import type { Assignee, TicketList } from '@/lib/ticket-types';

export const dynamic = 'force-dynamic';
const BOXES = ['inbox', 'sent', 'all'] as const;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string; new?: string; to?: string; about?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/tickets');
  if (user.role === 'merchant') redirect('/merchant');
  const q = await searchParams;
  const box = BOXES.includes(q.box as (typeof BOXES)[number])
    ? (q.box as (typeof BOXES)[number])
    : 'inbox';
  const [list, assignees, t] = await Promise.all([
    apiGet<TicketList>(`/tickets?box=${box}`),
    apiGet<Assignee[]>('/tickets/assignees'),
    getTranslations('tickets'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <Link href={homeFor(user.role) ?? '/'} className="text-body-sm text-link">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-h2">{t('title')}</h1>
        <p className="mt-1 text-body-sm text-text-muted">
          {list.slack ? t('introSlack') : t('intro')}
        </p>
        <TicketsInbox
          list={list}
          box={box}
          admin={user.role === 'admin'}
          assignees={assignees}
          startOpen={q.new === '1'}
          presetTo={q.to}
          about={q.about}
        />
      </main>
    </div>
  );
}
