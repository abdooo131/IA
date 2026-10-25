'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { Message, type ScannedBin, useStoreAction } from '@/components/store/useStoreAction';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import type { OrderDetail, OrderItemView } from '@/lib/order-types';
import { title } from '@/lib/store-types';
import { OrderStatusChip } from './OrderStatusChip';
import { OrderTimeline } from './OrderTimeline';
import { PhotoCapture } from './PhotoCapture';
import { StageTimer } from './StageTimer';

const KNOWN_ERRORS = [
  'invalid_order_state',
  'over_pick',
  'not_on_shelf',
  'sku_not_on_order',
  'not_fully_picked',
  'photo_required',
  'rider_not_found',
  'rider_other_store',
  'rider_full',
  'batch_would_break_sla',
  'photo_too_large',
  'photo_type_not_allowed',
  'too_late_to_cancel',
  'network',
];
const CANCEL_REASONS = ['customer_request', 'out_of_stock', 'duplicate', 'other'] as const;
const CANCELLABLE = ['new', 'accepted', 'picking', 'packed'];

const primary =
  'h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

const remaining = (i: OrderItemView) => i.quantity - i.pickedQty - i.cancelledQty;

/** The staff screen for one order: accept, pick by scan, pack with a photo, hand to a rider. */
export function OrderWork({ storeId, initial }: { storeId: string; initial: OrderDetail }) {
  const t = useTranslations('orders');
  const tScan = useTranslations('scan');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [order, setOrder] = useState(initial);
  const [shelf, setShelf] = useState<ScannedBin | null>(null);
  const [missing, setMissing] = useState<OrderItemView | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number]>('customer_request');

  const base = `/stores/${storeId}/orders/${order.id}`;
  const fail = (error: string) =>
    action.setMessage({
      text: t(`errors.${KNOWN_ERRORS.includes(error) ? error : 'generic'}`),
      error: true,
    });

  async function refresh() {
    const fresh = await apiGetClient<OrderDetail>(base);
    if (fresh.ok) setOrder(fresh.data);
  }

  /** Runs one action, shows its result and reloads the order either way. */
  async function run<T>(path: string, body: unknown, done?: (data: T) => string | null) {
    action.setBusy(true);
    action.setMessage(null);
    const result = await apiSend<T>('POST', `${base}/${path}`, body);
    if (result.ok) {
      const text = done?.(result.data);
      if (text) action.ok(text);
    } else fail(result.error);
    await refresh();
    action.setBusy(false);
    return result.ok;
  }

  async function onPickCode(code: string) {
    action.setBusy(true);
    action.setMessage(null);
    const lookup = await apiGetClient<{
      kind: 'sku' | 'bin';
      sku?: { id: string; sku: string };
      bin?: ScannedBin;
    }>(`/stores/${storeId}/lookup?code=${encodeURIComponent(code)}`);
    action.setBusy(false);
    if (!lookup.ok) {
      if (lookup.error === 'code_not_found')
        action.setMessage({ text: tScan('notFound', { code }), error: true });
      else fail(lookup.error);
      return;
    }
    if (lookup.data.kind === 'bin' && lookup.data.bin) {
      setShelf(lookup.data.bin);
      action.ok(t('actions.pickFrom', { bin: lookup.data.bin.code }));
      return;
    }
    const sku = lookup.data.sku!;
    if (!order.items.some((i) => i.skuId === sku.id)) return fail('sku_not_on_order');
    await run<{ bin: string | null }>(
      'pick',
      { skuId: sku.id, binId: shelf?.id, quantity: 1, idempotencyKey: newActionKey() },
      (data) => t('actions.picked', { sku: sku.sku, bin: data.bin ?? shelf?.code ?? '' }),
    );
  }

  async function confirmMissing(item: OrderItemView) {
    setMissing(null);
    await run('missing', {
      skuId: item.skuId,
      quantity: remaining(item),
      idempotencyKey: newActionKey(),
    });
  }

  const picking = order.status === 'accepted' || order.status === 'picking';
  const pickingDone = picking && order.items.every((i) => remaining(i) === 0);

  return (
    <div className="mt-2 space-y-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="ltr-iso text-h2">{order.number}</h1>
          <OrderStatusChip status={order.status} late={order.stage?.late} />
        </div>
        {order.stage && <StageTimer stage={order.stage.stage} dueAt={order.stage.dueAt} />}
        <p className="text-body-sm">
          {order.customerName} · <span className="ltr-iso">{order.customerPhone}</span> ·{' '}
          {order.merchant.name}
        </p>
        <p className="text-caption text-text-muted">{order.addressText}</p>
        {order.phoneFlagged && (
          <p className="rounded-md border border-status-needs-action px-3 py-2 text-body-sm text-status-needs-action">
            ⚠ {t('phoneFlagged')}
          </p>
        )}
        {order.customerNote && (
          <p className="text-body-sm">
            <span className="font-bold">{t('note')}:</span> {order.customerNote}
          </p>
        )}
        <p className="text-body-sm">
          {order.paymentMethod === 'cod' ? (
            <>
              {t('codAmount')}:{' '}
              <span className="ltr-iso font-bold">EGP {formatEgp(order.codAmountPiastres)}</span>
            </>
          ) : (
            t('prepaid')
          )}
        </p>
      </header>

      <Message message={action.message} />

      {order.status === 'new' && (
        <button
          type="button"
          className={primary}
          disabled={action.busy}
          onClick={() => void run('accept', {})}
        >
          {t('actions.accept')}
        </button>
      )}

      {picking && !pickingDone && (
        <section className="space-y-2">
          <p className="text-body-sm font-bold">{t('actions.scanToPick')}</p>
          <ScanBox onCode={(c) => void onPickCode(c)} disabled={action.busy} />
          <p className="text-caption text-text-muted">
            {t('actions.fromBin')}:{' '}
            <span className="ltr-iso">{shelf?.code ?? t('actions.anyShelf')}</span>
            {shelf && (
              <button
                type="button"
                className="ms-2 text-link underline"
                onClick={() => setShelf(null)}
              >
                ✕
              </button>
            )}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-h3">{t('items')}</h2>
        <ul className="space-y-2">
          {order.items.map((item) => {
            const left = remaining(item);
            return (
              <li
                key={item.skuId}
                className={`rounded-lg border p-3 ${left === 0 ? 'border-line bg-surface-raised' : 'border-line bg-surface'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-body-sm font-bold">{title(item, locale)}</p>
                    <p className="ltr-iso text-caption text-text-muted">{item.sku}</p>
                  </div>
                  <p className="ltr-iso text-body font-bold">
                    {item.pickedQty}/{item.quantity - item.cancelledQty}
                  </p>
                </div>
                {item.cancelledQty > 0 && (
                  <p className="text-caption text-danger">
                    {t('cancelledQty')}: {item.cancelledQty}
                  </p>
                )}
                {picking && left > 0 && item.bins && item.bins.length > 0 && (
                  <p className="text-caption">
                    {t('actions.fromBin')}:{' '}
                    <span className="ltr-iso">
                      {item.bins.map((b) => `${b.code} (${b.quantity})`).join(', ')}
                    </span>
                  </p>
                )}
                {picking &&
                  left > 0 &&
                  (missing?.skuId === item.skuId ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-body-sm">
                        {t('actions.missingConfirm', { count: left, sku: item.sku })}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={secondary}
                          onClick={() => void confirmMissing(item)}
                        >
                          {t('actions.yes')}
                        </button>
                        <button
                          type="button"
                          className={secondary}
                          onClick={() => setMissing(null)}
                        >
                          {t('actions.no')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`${secondary} mt-2 text-danger`}
                      disabled={action.busy}
                      onClick={() => setMissing(item)}
                    >
                      {t('actions.missing')}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      </section>

      {pickingDone && (
        <section className="space-y-2">
          <PhotoCapture
            kind="pack"
            label={t('actions.takePhoto')}
            onUploaded={setPhotoId}
            onError={fail}
          />
          <button
            type="button"
            className={primary}
            disabled={action.busy || !photoId}
            onClick={() => void run('pack', { photoId })}
          >
            {t('actions.pack')}
          </button>
        </section>
      )}

      {order.status === 'packed' && (
        <section className="space-y-2">
          <p className="text-body-sm font-bold">{t('actions.scanBadge')}</p>
          <ScanBox
            onCode={(badgeCode) =>
              void run<{ rider: string }>('handover', { badgeCode }, (d) =>
                t('actions.handedTo', { rider: d.rider }),
              )
            }
            disabled={action.busy}
          />
        </section>
      )}

      {order.status === 'failed' && (
        <button
          type="button"
          className={primary}
          disabled={action.busy}
          onClick={() =>
            void run<{ bin: string; units: number }>('return', {}, (d) =>
              t('actions.receivedBack', { units: d.units, bin: d.bin }),
            )
          }
        >
          {t('actions.receiveBack')}
        </button>
      )}

      {order.rider && (
        <p className="text-body-sm">
          {t('rider')}: {order.rider.name} (<span className="ltr-iso">{order.rider.badge}</span>)
        </p>
      )}

      {CANCELLABLE.includes(order.status) &&
        (cancelling ? (
          <section className="space-y-2 rounded-lg border border-danger p-3">
            <label className="block text-body-sm font-bold" htmlFor="cancel-reason">
              {t('actions.cancelReason')}
            </label>
            <select
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="h-12 w-full rounded-md border border-line bg-surface px-3"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`actions.cancelReasons.${r}`)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className={`${secondary} text-danger`}
                disabled={action.busy}
                onClick={() => {
                  setCancelling(false);
                  void run('cancel', { reason });
                }}
              >
                {t('actions.confirmCancel')}
              </button>
              <button type="button" className={secondary} onClick={() => setCancelling(false)}>
                {t('actions.no')}
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            className={`${secondary} text-danger`}
            onClick={() => setCancelling(true)}
          >
            {t('actions.cancel')}
          </button>
        ))}

      <section>
        <h2 className="mb-2 text-h3">{t('timeline')}</h2>
        <OrderTimeline events={order.events} />
      </section>
    </div>
  );
}
