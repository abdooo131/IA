'use client';
import { TICKET_KIND, TicketStatus, type Ticket } from '@/parcels/components/Tickets';
import { useRunner } from '@/parcels/components/money';
import { Button, Card } from '@/parcels/components/ui';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

/** A courier's or agent's quality tickets, with the appeal button while it is allowed. */
export function MyTickets({ showWho = false }: { showWho?: boolean }) {
  const t = useT();
  const list = useLoad<Ticket[]>('/my/tickets');
  const r = useRunner(() => list.reload());
  if (!list.data || list.data.length === 0) return null;
  return (
    <Card title={t('Quality tickets')}>
      <div className="space-y-2">
        {r.view}
        <ul className="divide-y divide-line text-body-sm">
          {list.data.map((x) => {
            const canAppeal = x.status === 'CONFIRMED' && !!x.appealUntil && new Date(x.appealUntil) > new Date();
            return (
              <li key={x.id} className="space-y-1 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{t(TICKET_KIND[x.kind] ?? x.kind)} <span className="ltr-iso text-caption text-text-muted">{x.code}</span></span>
                  <TicketStatus status={x.status} />
                </div>
                <p className="text-caption">{showWho && x.courierName ? `${x.courierName} · ` : ''}{x.description}</p>
                {x.penalty > 0 && <p className="text-caption">{t('Penalty')}: <span className="font-bold">{egp(x.penalty)}</span>{x.status === 'OPEN' && ` · ${t('Applies {time}', { time: dateTime(x.confirmAt) })}`}</p>}
                {canAppeal && (
                  <Button tone="secondary" onClick={() => { const text = window.prompt(t('Why should this penalty be reversed?')); if (text) void r.call(`/my/tickets/${x.id}/appeal`, { text }, 'Appeal sent'); }}>
                    {t('Appeal before {time}', { time: dateTime(x.appealUntil) })}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
