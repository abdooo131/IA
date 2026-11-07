import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { TicketThread } from '@/components/tickets/TicketThread';
import { apiGet } from '@/lib/api-server';
import { getCurrentUser } from '@/lib/server-session';
import type { TicketDetail } from '@/lib/ticket-types';

export const dynamic = 'force-dynamic';

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/tickets/${id}`);
  if (user.role === 'merchant') redirect('/merchant');
  const [ticket, t] = await Promise.all([
    apiGet<TicketDetail>(`/tickets/${id}`),
    getTranslations('tickets'),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href="/tickets" className="text-body-sm text-link">
          {t('allTickets')}
        </Link>
        <TicketThread ticket={ticket} />
      </main>
    </div>
  );
}
