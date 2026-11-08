'use client';
import { useEffect, useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { Button, Card, Field, Loading, Select, Textarea } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';
import { useLocations } from './locations';

interface Pickup {
  pickupAddress: string | null;
  governorateCode: string | null;
  areaId: string | null;
  ready: boolean;
}

/**
 * Where our courier picks the merchant's parcels up. A merchant won by Sales starts without one,
 * so next day parcels wait for it (owner, 2026-11-08).
 */
export function PickupAddressCard() {
  const t = useT();
  const locale = useLocale();
  const pickup = useLoad<Pickup>('/merchant/pickup-address');
  const { data: govs } = useLocations();
  const r = useRunner(() => pickup.reload());
  const [address, setAddress] = useState('');
  const [gov, setGov] = useState('');
  const [area, setArea] = useState('');
  useEffect(() => {
    if (!pickup.data) return;
    setAddress(pickup.data.pickupAddress ?? '');
    setGov(pickup.data.governorateCode ?? '');
    setArea(pickup.data.areaId ?? '');
  }, [pickup.data]);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const areas = govs?.find((g) => g.code === gov)?.areas ?? [];
  return (
    <Card title={t('Pickup address')}>
      {!pickup.data || !govs ? (
        <Loading />
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              () =>
                api('/merchant/pickup-address', {
                  method: 'PUT',
                  body: { pickupAddress: address, governorateCode: gov, areaId: area || null },
                }),
              'Pickup address saved. You can send next day parcels',
            );
          }}
        >
          {!pickup.data.ready && (
            <p className="text-body-sm font-semibold text-status-needs-action sm:col-span-2">
              {t('Add your pickup address before sending next day parcels.')}
            </p>
          )}
          <Field label={t('Governorate')}>
            <Select
              value={gov}
              required
              onChange={(e) => {
                setGov(e.target.value);
                setArea('');
              }}
            >
              <option value="">{t('Choose')}</option>
              {govs.map((g) => (
                <option key={g.code} value={g.code} disabled={!g.served}>
                  {name(g)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Area')}>
            <Select value={area} onChange={(e) => setArea(e.target.value)} disabled={!areas.length}>
              <option value="">{t('Any area')}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Address')} className="sm:col-span-2">
            <Textarea
              rows={2}
              required
              minLength={5}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={r.busy || !gov || address.trim().length < 5}>
              {t('Save pickup address')}
            </Button>
          </div>
        </form>
      )}
      {r.view}
    </Card>
  );
}
