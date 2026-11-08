'use client';
import Link from 'next/link';
import { useState } from 'react';
import { MoneyInput, toPiastres, useRunner } from '@/parcels/components/money';
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
import { api } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Claim {
  id: string;
  code: string;
  kind: 'lost' | 'damaged';
  description: string;
  status: 'OPEN' | 'APPROVED' | 'REJECTED';
  amount: number;
  fullAmount: number;
  decisionNote: string;
  createdAt: string;
  photoMime: string;
  merchant: { name: string };
  shipment: { id: string; trackingNumber: string; status: string; declaredValue: number };
}

const STATUSES = ['OPEN', 'APPROVED', 'REJECTED'] as const;
const STATUS_TONE = { OPEN: 'amber', APPROVED: 'green', REJECTED: 'slate' } as const;

/**
 * Merchant claims (owner, 2026-11-08): damage is claimed by the merchant, never reported on the
 * floor. Approving pays the merchant (the full compensation unless a smaller amount is entered);
 * a lost claim is approved by confirming the loss on Lost parcels once its search ends.
 */
export default function ClaimsPage() {
  const t = useT();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('OPEN');
  const list = useLoad<Claim[]>(`/control/claims?status=${status}`);
  const r = useRunner(list.reload);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Merchant claims')}
        subtitle={t(
          'Merchants claim parcels that arrived damaged or never arrived. Approving credits their wallet.',
        )}
      />
      <div className="flex flex-wrap gap-2" role="tablist">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`rounded-pill border px-3 py-1 text-body-sm font-semibold ${
              status === s ? 'border-primary bg-selected-bg text-link' : 'border-line bg-surface'
            }`}
          >
            {t(s === 'OPEN' ? 'Open' : s === 'APPROVED' ? 'Approved' : 'Rejected')}
          </button>
        ))}
      </div>
      {r.view}
      <Card>
        {!list.data ? (
          <Loading />
        ) : list.data.length === 0 ? (
          <Empty>{t('No claims here')}</Empty>
        ) : (
          <Table head={[t('Claim'), t('Parcel'), t('What happened'), t('Amount'), t('Decision')]}>
            {list.data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="ltr-iso font-bold">{c.code}</span>
                  <div className="text-caption text-text-muted">{c.merchant.name}</div>
                  <div className="text-caption text-text-muted">{dateTime(c.createdAt)}</div>
                </Td>
                <Td>
                  <Link
                    href={`/parcels/admin/shipments/${c.shipment.id}`}
                    className="ltr-iso font-bold text-link"
                  >
                    {c.shipment.trackingNumber}
                  </Link>
                  <div className="mt-1">
                    <Badge tone={c.kind === 'lost' ? 'amber' : 'red'}>
                      {t(c.kind === 'lost' ? 'Lost' : 'Damaged')}
                    </Badge>
                  </div>
                </Td>
                <Td>
                  <p className="max-w-xs whitespace-pre-wrap text-body-sm">{c.description}</p>
                  {c.photoMime && (
                    <a
                      className="text-caption font-semibold text-link"
                      href={`/api/parcels/control/claims/${c.id}/photo`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('See the photo')}
                    </a>
                  )}
                </Td>
                <Td>
                  <span className="ltr-iso">
                    {egp(c.status === 'APPROVED' ? c.amount : c.fullAmount)}
                  </span>
                  {c.status === 'OPEN' && (
                    <div className="text-caption text-text-muted">
                      {t(
                        'Full compensation: declared value up to the limit, plus the shipping fee',
                      )}
                    </div>
                  )}
                </Td>
                <Td>
                  {c.status !== 'OPEN' ? (
                    <div>
                      <Badge tone={STATUS_TONE[c.status]}>
                        {t(c.status === 'APPROVED' ? 'Approved' : 'Rejected')}
                      </Badge>
                      {c.decisionNote && (
                        <div className="mt-1 text-caption text-text-muted">{c.decisionNote}</div>
                      )}
                    </div>
                  ) : c.kind === 'lost' ? (
                    <span className="text-caption text-text-muted">
                      {t('Approved by confirming the loss on Lost parcels when the search ends')}
                    </span>
                  ) : (
                    <div className="grid gap-2">
                      <MoneyInput
                        placeholder={t('Full amount')}
                        value={amounts[c.id] ?? ''}
                        onChange={(v: string) => setAmounts((a) => ({ ...a, [c.id]: v }))}
                      />
                      <Input
                        aria-label={t('Note')}
                        placeholder={t('Note (needed to reject)')}
                        value={notes[c.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={r.busy}
                          onClick={() =>
                            void r.run(() => {
                              const raw = amounts[c.id]?.trim();
                              const amount = raw ? toPiastres(raw) : null;
                              return api(`/control/claims/${c.id}/approve`, {
                                body: { amount, note: notes[c.id] ?? '' },
                              });
                            }, 'Approved. The merchant was paid')
                          }
                        >
                          {t('Approve')}
                        </Button>
                        <Button
                          tone="secondary"
                          disabled={r.busy}
                          onClick={() =>
                            void r.call(
                              `/control/claims/${c.id}/reject`,
                              { note: notes[c.id] ?? '' },
                              'Rejected',
                            )
                          }
                        >
                          {t('Reject')}
                        </Button>
                      </div>
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
