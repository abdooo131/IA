'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatCairoTime, formatEgp } from '@/lib/format';
import {
  attemptsMade,
  callLog,
  plainStateKey,
  promiseOutcome,
  shopifyRef,
} from '@/lib/order-detail';
import { title } from '@/lib/store-types';
import { FailedAttemptPanel } from '../FailedAttemptPanel';
import { Card, Pill, Row } from './Card';
import { CollectionCard } from './CollectionCard';
import { NotesCard } from './NotesCard';
import type { OrderScreenProps } from './types';

const RISK_TONE = {
  unknown: 'new',
  low: 'delivered',
  medium: 'needs-action',
  high: 'danger',
} as const;

function Stars({ stars }: { stars: number }) {
  return (
    <span className="ltr-iso text-body tracking-wide" aria-hidden>
      <span className="text-status-needs-action">{'★'.repeat(stars)}</span>
      <span className="text-line-strong">{'★'.repeat(Math.max(0, 5 - stars))}</span>
    </span>
  );
}

/** Where the order is, in plain words (blue), and what comes next or what went wrong (yellow). */
function Banners({ props }: { props: OrderScreenProps }) {
  const { order, viewer } = props;
  const t = useTranslations('orderDetail.banner');
  const tReasons = useTranslations('rider.reasons');
  const tCancel = useTranslations('orders.actions.cancelReasons');
  const tClosed = useTranslations('orderDetail.reasons');
  const tStages = useTranslations('orders.stages');
  const locale = useLocale();
  const store = localized(order.darkStore, locale);
  const lastFailed = order.deliveries.find((d) => d.status === 'failed');
  // Reasons are stored as "code" or "code: what the person wrote".
  const raw = order.closedReason ?? lastFailed?.failedReason ?? '';
  const [code = '', ...rest] = raw.split(':');
  const said = rest.join(':').trim();
  const label = tReasons.has(code)
    ? tReasons(code)
    : tCancel.has(code)
      ? tCancel(code)
      : tClosed.has(code)
        ? tClosed(code)
        : code || t('noReason');
  const reason = said ? `${label} (“${said}”)` : label;
  const time = (iso: string | null) => (iso ? formatCairoTime(iso, locale) : '');
  const key = plainStateKey(order);
  const info = t(`state.${key}`, {
    store,
    rider: order.rider?.name ?? '',
    time: order.deliveredAt
      ? formatCairoDateTime(order.deliveredAt, locale)
      : time(order.slaStartsAt),
    reason,
  });

  let next: string | null = null;
  const outcome = promiseOutcome(order);
  if (order.status === 'attempt_failed') {
    next = order.retryHoldUntil
      ? t('nextDecide', { time: formatCairoDateTime(order.retryHoldUntil, locale) })
      : null;
  } else if (['new', 'accepted', 'picking', 'packed', 'out_for_delivery'].includes(order.status)) {
    if (order.slaDueAt) next = t('promise', { time: time(order.slaDueAt) });
    if (order.stage?.late || order.lateStage)
      next = `${next ?? ''} ${t('late', {
        stage: tStages(order.stage?.late ? order.stage.stage : (order.lateStage ?? 'ride')),
      })}`.trim();
  } else if (order.status === 'delivered' && outcome === 'late') {
    next = t('deliveredLate');
  } else if (order.status === 'moved_to_standard' && viewer === 'merchant') {
    next = t('shipYourself');
  }

  return (
    <div className="space-y-2">
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border-s-4 border-primary bg-selected-bg px-4 py-3 text-body-sm text-text"
      >
        <Icon name="tracking" size={18} className="mt-0.5 text-link" />
        <span>{info}</span>
      </p>
      {next && (
        <p className="flex items-start gap-2 rounded-lg border-s-4 border-status-needs-action bg-[color-mix(in_srgb,var(--shiply-status-needs-action)_10%,transparent)] px-4 py-3 text-body-sm text-text">
          <Icon name="schedule" size={18} className="mt-0.5 text-status-needs-action" />
          <span>{next}</span>
        </p>
      )}
    </div>
  );
}

function OperationCard({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orderDetail');
  const locale = useLocale();
  const calls = callLog(order);
  const outcome = promiseOutcome(order);
  return (
    <Card title={t('operation.title')} icon="courier">
      <dl>
        <Row label={t('operation.rider')}>
          {order.rider ? (
            <>
              {order.rider.name}{' '}
              <span className="ltr-iso text-text-muted">({order.rider.badge})</span>
            </>
          ) : (
            <span className="text-text-muted">{t('none')}</span>
          )}
        </Row>
        <Row label={t('operation.calls')}>
          <span className="ltr-iso">{calls.length}</span>
          {calls[0] && (
            <span className="text-text-muted">
              {' · '}
              {t.rich('operation.lastCall', {
                time: formatCairoDateTime(calls[0].at, locale),
                t: (chunks) => <span className="ltr-iso whitespace-nowrap">{chunks}</span>,
              })}
            </span>
          )}
        </Row>
        <Row label={t('operation.attempts')}>
          {t('operation.attemptsOf', { made: attemptsMade(order), max: order.maxAttempts })}
        </Row>
        <Row label={t('operation.expected')}>
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="ltr-iso whitespace-nowrap">
              {order.slaDueAt ? formatCairoDateTime(order.slaDueAt, locale) : t('none')}
            </span>
            {outcome && (
              <Pill tone={outcome === 'on_time' ? 'delivered' : 'needs-action'}>
                {t(`operation.${outcome}`)}
              </Pill>
            )}
          </span>
        </Row>
        {order.deliveredAt && (
          <Row label={t('operation.deliveredAt')}>
            <span className="ltr-iso whitespace-nowrap">
              {formatCairoDateTime(order.deliveredAt, locale)}
            </span>
          </Row>
        )}
        {order.deliveryOtp && (
          <Row label={t('operation.code')}>
            <span className="ltr-iso font-bold tracking-widest">{order.deliveryOtp}</span>
          </Row>
        )}
        <Row label={t('operation.rating')}>
          {order.rating ? (
            <span className="inline-flex flex-col items-end">
              <span className="inline-flex items-center gap-1">
                <Stars stars={order.rating.stars} />
                <span className="sr-only">
                  {t('operation.stars', { stars: order.rating.stars })}
                </span>
              </span>
              {order.rating.comment && (
                <span className="mt-0.5 text-caption text-text-muted">
                  “{order.rating.comment}”
                </span>
              )}
            </span>
          ) : (
            <span className="text-text-muted">{t('operation.noRating')}</span>
          )}
        </Row>
      </dl>
    </Card>
  );
}

function ConsigneeCard({ props }: { props: OrderScreenProps }) {
  const { order, viewer, customer } = props;
  const t = useTranslations('orderDetail');
  const tc = useTranslations('customers');
  const locale = useLocale();
  const area = order.area
    ? [localized(order.area, locale), order.area.parent && localized(order.area.parent, locale)]
        .filter(Boolean)
        .join(' · ')
    : order.zone
      ? localized(order.zone, locale)
      : null;
  return (
    <Card
      title={t('consignee.title')}
      icon="customers"
      action={
        customer && (
          <Pill tone={RISK_TONE[customer.risk.level]}>
            {tc(`riskLevels.${customer.risk.level}`)}
          </Pill>
        )
      }
    >
      <dl>
        <Row label={t('consignee.name')} strong>
          {order.customerName}
        </Row>
        <Row label={t('consignee.phone')}>
          {viewer === 'admin' ? (
            <a href={`tel:${order.customerPhone}`} className="ltr-iso font-bold text-link">
              {order.customerPhone}
            </a>
          ) : (
            <span className="ltr-iso">{order.customerPhone}</span>
          )}
          {order.phoneFlagged && (
            <span className="block text-caption text-status-needs-action">
              {t('consignee.phoneFlagged')}
            </span>
          )}
        </Row>
        <Row label={t('consignee.address')}>
          <span className="break-words">{order.addressText}</span>
        </Row>
        <Row label={t('consignee.area')}>
          {area ?? <span className="text-text-muted">{t('none')}</span>}
        </Row>
        <Row label={t('consignee.store')}>
          {localized(order.darkStore, locale)}{' '}
          <span className="ltr-iso text-text-muted">({order.darkStore.code})</span>
        </Row>
        {order.zone && order.area && (
          <Row label={t('consignee.zone')}>{localized(order.zone, locale)}</Row>
        )}
      </dl>
      {customer && (
        <p className="mt-3 rounded-lg bg-surface-raised px-3 py-2 text-caption">
          <span className="font-bold">{t('consignee.insight')}</span>{' '}
          {customer.risk.attempts > 0
            ? t('consignee.insightLine', {
                pct: 100 - customer.risk.pct,
                attempts: customer.risk.attempts,
                failed: customer.risk.failed,
              })
            : t('consignee.insightNone')}
        </p>
      )}
    </Card>
  );
}

function ShipmentCard({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orderDetail.shipment');
  const locale = useLocale();
  const units = order.items.reduce((s, i) => s + i.quantity - i.cancelledQty, 0);
  return (
    <Card
      title={t('title')}
      icon="packaging"
      action={
        <span className="text-caption text-text-muted">
          {t('count', { lines: order.items.length, units })}
        </span>
      }
    >
      <ul className="divide-y divide-line">
        {order.items.map((i) => (
          <li key={i.skuId} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            {i.imageUrl ? (
              // Shopify's own picture of the product (cdn.shopify.com).
              <img
                src={i.imageUrl}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-md border border-line bg-surface-raised object-cover"
              />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-raised text-text-muted">
                <Icon name="products" size={24} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-bold">{title(i, locale)}</p>
              <p className="ltr-iso text-caption text-text-muted">{i.sku}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-caption">
                <span>{t('ordered', { n: i.quantity })}</span>
                <span>{t('picked', { n: i.pickedQty })}</span>
                {i.cancelledQty > 0 && (
                  <span className="font-bold text-danger">
                    {t('cancelled', { n: i.cancelledQty })}
                  </span>
                )}
              </p>
            </div>
            <p className="ltr-iso shrink-0 text-body-sm font-bold">
              {formatEgp(i.unitPricePiastres * (i.quantity - i.cancelledQty))}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AdditionalCard({ props }: { props: OrderScreenProps }) {
  const { order, viewer } = props;
  const t = useTranslations('orderDetail.additional');
  const locale = useLocale();
  const ref = shopifyRef(order.shopifyOrderId);
  return (
    <Card title={t('title')} icon="invoice">
      <dl>
        <Row label={t('source')}>
          {t(`sources.${order.source}`)}
          {ref && <span className="ltr-iso text-text-muted"> · #{ref}</span>}
        </Row>
        {viewer === 'admin' && <Row label={t('merchant')}>{order.merchant.name}</Row>}
        <Row label={t('returnTo')}>{localized(order.darkStore, locale)}</Row>
        <Row label={t('notes')}>
          {order.customerNote ? (
            <span className="break-words">{order.customerNote}</span>
          ) : (
            <span className="text-text-muted">{t('noNotes')}</span>
          )}
        </Row>
        {order.trackingToken && (
          <Row label={t('tracking')}>
            <a
              href={`/t/${order.trackingToken}`}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-link underline"
            >
              {t('openTracking')}
            </a>
          </Row>
        )}
      </dl>
    </Card>
  );
}

/** The details tab: banners, the four cards on the wide side, notes and money on the narrow. */
export function DetailsTab({
  props,
  onNotice,
}: {
  props: OrderScreenProps;
  onNotice(text: string): void;
}) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Banners props={props} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {props.order.status === 'attempt_failed' && (
            <div id="decision">
              <FailedAttemptPanel
                order={props.order}
                decisionPath={`${props.apiPath}/decision`}
                onDone={(text) => {
                  onNotice(text);
                  router.refresh();
                }}
              />
            </div>
          )}
          <OperationCard props={props} />
          <ConsigneeCard props={props} />
          <ShipmentCard props={props} />
          <AdditionalCard props={props} />
        </div>
        <div className="space-y-4">
          <NotesCard props={props} />
          <CollectionCard props={props} />
        </div>
      </div>
    </div>
  );
}
