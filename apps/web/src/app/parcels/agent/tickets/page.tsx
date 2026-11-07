'use client';
import { MyTickets } from '@/parcels/components/MyTickets';
import { Empty, PageHeader } from '@/parcels/components/ui';
import { useT } from '@/parcels/lib/i18n';

export default function AgentTickets() {
  const t = useT();
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Quality tickets')}
        subtitle={t(
          'Tickets against your staff. You can appeal a penalty within the appeal window.',
        )}
      />
      <MyTickets showWho />
      <Empty>{t('Tickets appear here when operations open one against your staff')}</Empty>
    </div>
  );
}
