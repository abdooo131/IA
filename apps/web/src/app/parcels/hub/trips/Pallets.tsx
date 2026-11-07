'use client';
import { useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { PhotoButton, photoBody } from '@/parcels/components/PhotoButton';
import { ScanBox } from '@/parcels/components/ScanBox';
import { useRunner } from '@/parcels/components/money';
import { Badge, Button, Card, Field, Input, Select } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

export interface Pallet {
  id: string;
  code: string;
  status: string;
  sealNo: string;
  outgoing: boolean;
  destination: { code: string; name: string } | null;
  origin: { code: string; name: string } | null;
  bags: { id: string; code: string; parcels: number }[];
}

/** Outbound: put sealed bags for the same place on a pallet, seal it with a seal number and a photo. */
export function Pallets({ onChange }: { onChange: () => void }) {
  const t = useT();
  const hub = useHub();
  const list = useLoad<Pallet[]>(`/hubs/${hub.id}/pallets`);
  const hubs = useLoad<{ id: string; code: string; name: string }[]>('/reference/hubs');
  const r = useRunner(async () => {
    await list.reload();
    onChange();
  });
  const [dest, setDest] = useState('');
  const [seal, setSeal] = useState<Record<string, { no: string; photo: string | null }>>({});
  const mine = (list.data ?? []).filter((p) => p.outgoing);
  return (
    <Card title={t('Pallets (master waybill)')}>
      <div className="space-y-4">
        {r.view}
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('New pallet to')}>
            <Select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">{t('Choose')}</option>
              {(hubs.data ?? [])
                .filter((h) => h.id !== hub.id)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code} · {h.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Button
            disabled={!dest}
            onClick={() =>
              void r.call(
                `/hubs/${hub.id}/pallets`,
                { destinationHubId: dest },
                'Pallet created. Scan sealed bags onto it',
              )
            }
          >
            {t('Create pallet')}
          </Button>
        </div>
        {mine.map((p) => {
          const s = seal[p.id] ?? { no: '', photo: null };
          return (
            <div key={p.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  <span className="ltr-iso">{p.code}</span> →{' '}
                  <span className="ltr-iso">{p.destination?.code}</span>
                </p>
                {p.status === 'SEALED' ? (
                  <Badge tone="green">
                    {t('Sealed')} · <span className="ltr-iso">{p.sealNo}</span>
                  </Badge>
                ) : (
                  <Badge tone="amber">{t('Loading')}</Badge>
                )}
              </div>
              <p className="mt-1 text-caption text-text-muted">
                <span className="ltr-iso">
                  {p.bags.map((b) => `${b.code} (${b.parcels})`).join(', ') || t('No bags yet')}
                </span>
              </p>
              {p.status === 'LOADING' && (
                <div className="mt-3 space-y-3">
                  <ScanBox
                    size="md"
                    autoFocus={false}
                    label={t('Scan a sealed bag onto this pallet')}
                    placeholder="BG00123"
                    onScan={async (c) => {
                      const x = await api<{ message: string }>(
                        `/hubs/${hub.id}/pallets/${p.id}/bags`,
                        { body: { code: c } },
                      );
                      void list.reload();
                      return { text: x.message };
                    }}
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('Seal number')}>
                      <Input
                        className="ltr-iso w-40"
                        value={s.no}
                        onChange={(e) => setSeal({ ...seal, [p.id]: { ...s, no: e.target.value } })}
                      />
                    </Field>
                    <PhotoButton
                      value={s.photo}
                      onChange={(photo) => setSeal({ ...seal, [p.id]: { ...s, photo } })}
                      label={t('Photo of the pallet')}
                    />
                    <Button
                      disabled={!s.no || !s.photo || p.bags.length === 0}
                      onClick={() =>
                        void r.call(
                          `/hubs/${hub.id}/pallets/${p.id}/seal`,
                          { sealNo: s.no, photo: photoBody(s.photo!) },
                          'Pallet sealed. Scan it onto a truck',
                        )
                      }
                    >
                      {t('Seal pallet')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Inbound: pallets on their way here; record their condition with a photo before opening the bags. */
export function IncomingPallets() {
  const t = useT();
  const hub = useHub();
  const list = useLoad<Pallet[]>(`/hubs/${hub.id}/pallets`);
  const r = useRunner(() => list.reload());
  const [state, setState] = useState<
    Record<string, { condition: string; note: string; photo: string | null }>
  >({});
  const incoming = (list.data ?? []).filter((p) => !p.outgoing);
  if (incoming.length === 0) return null;
  return (
    <Card title={t('Pallets coming here')} className="mt-4">
      <div className="space-y-3">
        {r.view}
        {incoming.map((p) => {
          const s = state[p.id] ?? { condition: 'GOOD', note: '', photo: null };
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  <span className="ltr-iso">{p.code}</span> ←{' '}
                  <span className="ltr-iso">{p.origin?.code}</span>
                </p>
                <p className="text-caption text-text-muted">
                  {t('Seal')} <span className="ltr-iso font-bold text-text">{p.sealNo}</span> ·{' '}
                  {t('{count} bags', { count: p.bags.length })}
                </p>
              </div>
              <Select
                value={s.condition}
                onChange={(e) =>
                  setState({ ...state, [p.id]: { ...s, condition: e.target.value } })
                }
              >
                <option value="GOOD">{t('Arrived whole, seal intact')}</option>
                <option value="DAMAGED">{t('Damaged or seal broken')}</option>
              </Select>
              {s.condition === 'DAMAGED' && (
                <Input
                  placeholder={t('What is wrong')}
                  value={s.note}
                  onChange={(e) => setState({ ...state, [p.id]: { ...s, note: e.target.value } })}
                />
              )}
              <PhotoButton
                value={s.photo}
                onChange={(photo) => setState({ ...state, [p.id]: { ...s, photo } })}
              />
              <Button
                disabled={!s.photo}
                onClick={() =>
                  void r.call(
                    `/hubs/${hub.id}/pallets/${p.id}/receive`,
                    { condition: s.condition, note: s.note, photo: photoBody(s.photo!) },
                    'Pallet received',
                  )
                }
              >
                {t('Receive pallet')}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
