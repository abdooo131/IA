'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatCairoTime } from '@/lib/format';
import { callLog, orderPhotos, orderSteps } from '@/lib/order-detail';
import { Card } from './Card';
import type { OrderScreenProps } from './types';

/** Store work happens at the store; the rest happens on the road. */
const AT_STORE = new Set([
  'created',
  'accepted',
  'picking_started',
  'item_picked',
  'item_missing',
  'picking_done',
  'packed',
  'items_cancelled',
  'returned_to_store',
  'goods_back_for_retry',
  'queued_until_open',
  'handed_to_rider',
]);
const ON_ROAD = new Set([
  'delivered',
  'delivery_failed',
  'delivery_attempt_failed',
  'customer_called',
]);

function detailOf(
  type: string,
  data: Record<string, unknown> | null,
  reason: (code: string) => string,
): string | null {
  if (!data) return null;
  if (type === 'item_picked') return `${data.sku} × ${data.quantity} · ${data.bin}`;
  if (type === 'item_missing') return `${data.sku} × ${data.quantity}`;
  if (type === 'handed_to_rider') return `${data.rider} (${data.badge})`;
  if (type === 'items_cancelled' && Array.isArray(data.lines))
    return (data.lines as { sku: string; quantity: number }[])
      .map((l) => `${l.sku} × ${l.quantity}`)
      .join(', ');
  if (type === 'delivery_failed' || type === 'delivery_attempt_failed' || type === 'cancelled')
    return reason(String(data.reason ?? '').split(':')[0]!);
  if (type === 'returned_to_store') return `${data.units} → ${data.bin}`;
  return null;
}

/** The order path as a horizontal stepper (vertical on phones), each step with its time. */
function Stepper({ props }: { props: OrderScreenProps }) {
  const t = useTranslations('workflow.states');
  const td = useTranslations('orderDetail.tracking');
  const locale = useLocale();
  const steps = orderSteps(props.order);
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0" aria-label={td('path')}>
      {steps.map((s, i) => {
        const tone =
          s.state === 'side'
            ? 'bg-danger text-on-primary'
            : s.state === 'done'
              ? 'bg-primary text-on-primary'
              : s.state === 'current'
                ? 'bg-primary text-on-primary ring-4 ring-selected-bg'
                : 'bg-surface-raised text-text-muted';
        return (
          <li
            key={s.status}
            aria-current={s.state === 'current' || s.state === 'side' ? 'step' : undefined}
            className="relative flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute hidden h-0.5 sm:block sm:top-4 sm:-start-1/2 sm:w-full ${
                  s.state === 'todo' ? 'bg-line' : s.state === 'side' ? 'bg-danger' : 'bg-primary'
                }`}
                style={{ zIndex: 0 }}
              />
            )}
            <span
              className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-caption font-bold ${tone}`}
            >
              {s.state === 'done' || (s.state === 'current' && s.status === 'delivered')
                ? '✓'
                : s.state === 'side'
                  ? '!'
                  : i + 1}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-body-sm font-bold ${
                  s.state === 'side' ? 'text-danger' : s.state === 'todo' ? 'text-text-muted' : ''
                }`}
              >
                {t.has(s.status) ? t(s.status) : s.status}
              </span>
              <span className="ltr-iso block text-caption text-text-muted">
                {s.at ? formatCairoTime(s.at, locale) : '—'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Timeline({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orders');
  const td = useTranslations('orderDetail.tracking');
  const tRider = useTranslations('rider.reasons');
  const tCancel = useTranslations('orders.actions.cancelReasons');
  const locale = useLocale();
  const reason = (code: string) =>
    tRider.has(code) ? tRider(code) : tCancel.has(code) ? tCancel(code) : code;
  const store = localized(order.darkStore, locale);
  const area = order.area ? localized(order.area, locale) : td('customerDoor');
  const events = [...order.events].reverse();
  return (
    <Card title={td('timeline')} icon="schedule">
      {events.length === 0 ? (
        <p className="text-body-sm text-text-muted">{td('noEvents')}</p>
      ) : (
        <ol className="space-y-4 border-s-2 border-line ps-5">
          {events.map((e, i) => {
            const detail = detailOf(e.type, e.data, reason);
            const where = AT_STORE.has(e.type) ? store : ON_ROAD.has(e.type) ? area : null;
            const bad = [
              'late',
              'delivery_failed',
              'delivery_attempt_failed',
              'item_missing',
              'cancelled',
            ].includes(e.type);
            return (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className={`absolute -start-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-surface ${
                    i === 0 ? 'bg-primary' : bad ? 'bg-status-needs-action' : 'bg-line-strong'
                  }`}
                />
                <p className="text-body-sm font-bold">
                  {t.has(`events.${e.type}`) ? t(`events.${e.type}`) : e.type}
                </p>
                {detail && <p className="ltr-iso text-caption">{detail}</p>}
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">{formatCairoDateTime(e.at, locale)}</span>
                  {e.by && <> · {e.by}</>}
                  {where && <> · {where}</>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

type LogTab = 'calls' | 'messages' | 'photos';

function ContactLog({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orderDetail.tracking');
  const locale = useLocale();
  const [tab, setTab] = useState<LogTab>('calls');
  const calls = callLog(order);
  const photos = orderPhotos(order);
  const count: Record<LogTab, number> = { calls: calls.length, messages: 0, photos: photos.length };
  return (
    <Card title={t('contactLog')} icon="support">
      <div role="tablist" className="mb-3 flex gap-1 rounded-lg bg-surface-raised p-1">
        {(['calls', 'messages', 'photos'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-md px-2 py-1.5 text-caption font-bold ${
              tab === k ? 'bg-surface text-text shadow-sm' : 'text-text-muted'
            }`}
          >
            {t(`tabs.${k}`)} <span className="ltr-iso text-text-muted">{count[k]}</span>
          </button>
        ))}
      </div>
      {tab === 'calls' &&
        (calls.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noCalls')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {calls.map((c, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-selected-bg text-link">
                  <Icon name="support" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-bold">
                    {t('call', { n: c.attempt ?? calls.length - i })}
                  </span>
                  <span className="block text-caption text-text-muted">
                    <span className="ltr-iso">{formatCairoDateTime(c.at, locale)}</span>
                    {c.by && <> · {c.by}</>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}
      {tab === 'messages' && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Icon name="chat" size={28} className="text-text-muted" />
          <p className="text-body-sm text-text-muted">{t('messagesLater')}</p>
        </div>
      )}
      {tab === 'photos' &&
        (photos.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noPhotos')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {photos.map((p) => (
              <li key={p.id}>
                <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={`/api/photos/${p.id}`}
                    alt={t(`photos.${p.kind}`)}
                    className="aspect-square w-full rounded-md border border-line object-cover"
                  />
                </a>
                <p className="mt-1 text-caption font-bold">{t(`photos.${p.kind}`)}</p>
                {p.at && (
                  <p className="ltr-iso text-caption text-text-muted">
                    {formatCairoDateTime(p.at, locale)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}

export function TrackingTab({ props }: { props: OrderScreenProps }) {
  const t = useTranslations('orderDetail.tracking');
  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-surface p-4 shadow-sm sm:p-5" aria-label={t('path')}>
        <h2 className="mb-4 flex items-center gap-2 text-h3">
          <Icon name="route" size={20} className="text-link" />
          {t('path')}
        </h2>
        <Stepper props={props} />
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Timeline props={props} />
        </div>
        <ContactLog props={props} />
      </div>
    </div>
  );
}
