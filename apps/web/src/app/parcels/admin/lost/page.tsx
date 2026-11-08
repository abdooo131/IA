'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { TICKET_KIND } from '@/parcels/components/Tickets';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
} from '@/parcels/components/ui';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type State = 'searching' | 'to_confirm' | 'lost' | 'damaged';
interface Row {
  id: string;
  trackingNumber: string;
  status: string;
  state: State;
  customerName: string;
  codAmount: number;
  declaredValue: number;
  shippingFee: number;
  fullAmount: number;
  searchStartedAt: string | null;
  searchUntil: string | null;
  lostFinalAt: string | null;
  compensation: number;
  merchant: { name: string };
  lostHub: { code: string; name: string } | null;
  ticket: { code: string; status: string; kind: string; responsible: string } | null;
}

const TABS: { id: State; label: string; hint: string }[] = [
  {
    id: 'searching',
    label: 'In search',
    hint: 'No scan for too long, a merchant claim, or marked missing. Scanning the parcel anywhere ends the search and it continues on its way.',
  },
  {
    id: 'to_confirm',
    label: 'To confirm',
    hint: 'The search ended without finding it. Confirm the loss to compensate the merchant: the declared value up to the limit. A lost parcel is never charged its shipping fee.',
  },
  {
    id: 'lost',
    label: 'Lost',
    hint: 'Confirmed losses. If one turns up, scanning it takes the compensation back.',
  },
  {
    id: 'damaged',
    label: 'Damaged',
    hint: 'Parcels with an approved damage claim still in the network.',
  },
];

/**
 * Lost parcels (owner, 2026-11-08): parcels that stop being scanned are searched for on their own;
 * after the search a person confirms the loss and the merchant is compensated. Each row names the
 * station that had the parcel last (it left that station's stock when the search began).
 */
export default function LostPage() {
  const t = useT();
  const list = useLoad<Row[]>('/control/lost');
  const r = useRunner(list.reload);
  const [tab, setTab] = useState<State>('searching');
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!list.data) return <Loading />;
  const rows = list.data.filter((x) => x.state === tab);
  const count = (s: State) => list.data!.filter((x) => x.state === s).length;
  const current = TABS.find((x) => x.id === tab)!;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Lost parcels')}
        subtitle={t(
          'Parcels that stop moving are searched for on their own. A person confirms a loss before the merchant is paid.',
        )}
      />
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`rounded-pill border px-3 py-1 text-body-sm font-semibold ${
              tab === x.id ? 'border-primary bg-selected-bg text-link' : 'border-line bg-surface'
            }`}
          >
            {t(x.label)} · <span className="ltr-iso">{count(x.id)}</span>
          </button>
        ))}
      </div>
      <p className="text-body-sm text-text-muted">{t(current.hint)}</p>
      {r.view}
      <Card>
        {rows.length === 0 ? (
          <Empty>{t('Nothing here')}</Empty>
        ) : (
          <Table
            head={[
              t('Parcel'),
              t('Merchant'),
              t('Lost at'),
              t('State'),
              t('Held responsible'),
              t('Compensation'),
            ]}
          >
            {rows.map((x) => (
              <tr key={x.id}>
                <Td>
                  <Link
                    href={`/parcels/admin/shipments/${x.id}`}
                    className="ltr-iso font-bold text-link"
                  >
                    {x.trackingNumber}
                  </Link>
                  <div className="text-caption text-text-muted">{x.customerName}</div>
                </Td>
                <Td>{x.merchant.name}</Td>
                <Td>
                  {x.lostHub ? (
                    <span>
                      <span className="ltr-iso">{x.lostHub.code}</span> · {x.lostHub.name}
                    </span>
                  ) : (
                    '–'
                  )}
                  {x.searchStartedAt && (
                    <div className="text-caption text-text-muted">
                      {t('Since {time}', { time: dateTime(x.searchStartedAt) })}
                    </div>
                  )}
                </Td>
                <Td>
                  {x.state === 'searching' && (
                    <Badge tone="amber">
                      {t('In search until {time}', { time: dateTime(x.searchUntil) })}
                    </Badge>
                  )}
                  {x.state === 'to_confirm' && <Badge tone="red">{t('Not found, confirm')}</Badge>}
                  {x.state === 'lost' && (
                    <Badge tone="red">
                      {t('Lost, merchant paid {amount}', { amount: egp(x.compensation) })}
                    </Badge>
                  )}
                  {x.state === 'damaged' && <Badge tone="red">{t('Damaged')}</Badge>}
                </Td>
                <Td>
                  {x.ticket ? (
                    <span>
                      {x.ticket.responsible || t('Nobody on record')}
                      <div className="text-caption text-text-muted">
                        <span className="ltr-iso">{x.ticket.code}</span> ·{' '}
                        {t(TICKET_KIND[x.ticket.kind] ?? x.ticket.kind)}
                      </div>
                    </span>
                  ) : (
                    '–'
                  )}
                </Td>
                <Td>
                  <div className="ltr-iso">
                    {egp(x.state === 'lost' ? x.compensation : x.fullAmount)}
                  </div>
                  <div className="text-caption text-text-muted">
                    {x.declaredValue > 0
                      ? t('Declared value {value}', { value: egp(x.declaredValue) })
                      : t('No value declared: cash {value}', { value: egp(x.codAmount) })}
                  </div>
                  {x.state === 'to_confirm' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        aria-label={t('Note')}
                        placeholder={t('Note (optional)')}
                        value={notes[x.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [x.id]: e.target.value }))}
                      />
                      <Button
                        disabled={r.busy}
                        onClick={() =>
                          void r.call(
                            `/control/lost/${x.id}/confirm`,
                            { note: notes[x.id] ?? '' },
                            'Loss confirmed. The merchant was compensated',
                          )
                        }
                      >
                        {t('Confirm the loss')}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
