'use client';
import { useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { PhotoButton, photoBody } from '@/parcels/components/PhotoButton';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
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
  decisionNote: string;
  createdAt: string;
  shipment: { trackingNumber: string; status: string; searchUntil: string | null };
}

const TONE = { OPEN: 'amber', APPROVED: 'green', REJECTED: 'slate' } as const;

/**
 * Claims (owner, 2026-11-08): a parcel that reached the customer or came back damaged, or never
 * arrived, is claimed here. A lost claim starts the search at once; an approved claim credits
 * the wallet with the item value declared on the parcel, up to the limit, plus the shipping fee
 * when it was charged (a lost parcel never is).
 */
export default function MerchantClaimsPage() {
  const t = useT();
  const list = useLoad<Claim[]>('/merchant/claims');
  const r = useRunner(list.reload);
  const [tracking, setTracking] = useState('');
  const [kind, setKind] = useState<'damaged' | 'lost'>('damaged');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const submit = async () => {
    const ok = await r.run(
      () =>
        api('/merchant/claims', {
          body: {
            trackingNumber: tracking.trim(),
            kind,
            description,
            photo: photo ? photoBody(photo) : null,
          },
        }),
      kind === 'lost'
        ? 'Claim opened. We started searching for the parcel'
        : 'Claim opened. We will review it and reply here',
    );
    if (ok) {
      setTracking('');
      setDescription('');
      setPhoto(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Claims')}
        subtitle={t(
          'Claim a parcel that arrived damaged or never arrived. Approved claims are paid into your wallet.',
        )}
      />
      <Card title={t('Open a claim')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Tracking number')}>
            <Input
              dir="ltr"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="SHP0000010001"
            />
          </Field>
          <Field label={t('What happened')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'damaged' | 'lost')}>
              <option value="damaged">{t('It arrived damaged')}</option>
              <option value="lost">{t('It never arrived')}</option>
            </Select>
          </Field>
          <Field label={t('Describe the problem')} className="sm:col-span-2">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <PhotoButton value={photo} onChange={setPhoto} label={t('Add a photo (optional)')} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={r.busy || !tracking.trim() || description.trim().length < 5}
            onClick={() => void submit()}
          >
            {t('Send the claim')}
          </Button>
          <span className="text-caption text-text-muted">
            {t(
              'Compensation is the item value you declared on the parcel, up to the limit. If the parcel arrived damaged, the shipping fee is given back too; a lost parcel is never charged one.',
            )}
          </span>
        </div>
        {r.view}
      </Card>
      <Card title={t('Your claims')}>
        {!list.data ? (
          <Loading />
        ) : list.data.length === 0 ? (
          <Empty>{t('No claims yet')}</Empty>
        ) : (
          <Table head={[t('Claim'), t('Parcel'), t('What happened'), t('Status'), t('Paid')]}>
            {list.data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="ltr-iso font-bold">{c.code}</span>
                  <div className="text-caption text-text-muted">{dateTime(c.createdAt)}</div>
                </Td>
                <Td>
                  <span className="ltr-iso">{c.shipment.trackingNumber}</span>
                  <div className="text-caption text-text-muted">
                    {t(c.kind === 'lost' ? 'Never arrived' : 'Arrived damaged')}
                  </div>
                </Td>
                <Td>
                  <p className="max-w-xs whitespace-pre-wrap text-body-sm">{c.description}</p>
                </Td>
                <Td>
                  <Badge tone={TONE[c.status]}>
                    {t(
                      c.status === 'OPEN'
                        ? c.kind === 'lost'
                          ? 'We are searching'
                          : 'Under review'
                        : c.status === 'APPROVED'
                          ? 'Approved'
                          : 'Closed',
                    )}
                  </Badge>
                  {c.decisionNote && (
                    <div className="mt-1 text-caption text-text-muted">{c.decisionNote}</div>
                  )}
                </Td>
                <Td>
                  {c.status === 'APPROVED' ? <span className="ltr-iso">{egp(c.amount)}</span> : '–'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
