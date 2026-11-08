'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatCairoTime } from '@/lib/format';
import {
  attemptsMade,
  callLog,
  plainStateKey,
  promiseOutcome,
  shopifyRef,
} from '@/lib/order-detail';
import { title } from '@/lib/store-types';
import { FailedAttemptPanel } from '../FailedAttemptPanel';
import {
  type BannerTone,
  Field,
  Fields,
  OrderColumns,
  Section,
  Stars,
  StateBanner,
  Tag,
} from '../page/OrderLayout';
import { CollectionCard } from './CollectionCard';
import { NotesCard } from './NotesCard';
import type { OrderScreenProps } from './types';

const RISK_TONE = {
  unknown: 'new',
  low: 'delivered',
  medium: 'needs-action',
  high: 'danger',
} as const;

/** Where the order is, in plain words, and what comes next, in the colour of its state. */
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

  const tone: BannerTone =
    order.status === 'delivered'
      ? 'success'
      : ['cancelled', 'failed', 'moved_to_standard'].includes(order.status)
        ? 'danger'
        : order.status === 'attempt_failed'
          ? 'warning'
          : 'info';
  return <StateBanner tone={tone} text={info} next={next} />;
}

function OperationSection({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orderDetail.operation');
  const locale = useLocale();
  const calls = callLog(order);
  const outcome = promiseOutcome(order);
  return (
    <Section title={t('title')}>
      <Fields>
        <Field
          label={t('contact')}
          end={calls[0] ? formatCairoDateTime(calls[0].at, locale) : undefined}
        >
          {calls.length > 0 ? (
            <Tag tone="delivered">{t('callsCount', { n: calls.length })}</Tag>
          ) : (
            <span className="text-text-muted">{t('noCalls')}</span>
          )}
        </Field>
        <Field label={t('confirmed')}>
          {order.deliveredAt ? (
            <span className="ltr-iso">{formatCairoDateTime(order.deliveredAt, locale)}</span>
          ) : (
            <span className="text-text-muted">{t('notDelivered')}</span>
          )}
        </Field>
      </Fields>
      <Fields>
        <Field label={t('attempts')}>
          {t('attemptsLong', { made: attemptsMade(order), max: order.maxAttempts })}
        </Field>
        <Field label={t('expected')}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="ltr-iso">
              {order.slaDueAt ? formatCairoDateTime(order.slaDueAt, locale) : '–'}
            </span>
            {outcome && (
              <Tag tone={outcome === 'on_time' ? 'delivered' : 'needs-action'}>{t(outcome)}</Tag>
            )}
          </span>
        </Field>
      </Fields>
      <Fields>
        <Field label={t('rider')}>
          {order.rider ? (
            <>
              {order.rider.name}{' '}
              <span className="ltr-iso text-text-muted">({order.rider.badge})</span>
            </>
          ) : (
            '–'
          )}
        </Field>
        {order.deliveryOtp && (
          <Field label={t('code')}>
            <span className="ltr-iso font-bold tracking-widest">{order.deliveryOtp}</span>
          </Field>
        )}
      </Fields>
      <Fields>
        <Field label={t('rating')}>
          {order.rating ? (
            <Stars stars={order.rating.stars} label={t('stars', { stars: order.rating.stars })} />
          ) : (
            <span className="text-text-muted">{t('noRating')}</span>
          )}
        </Field>
        <Field label={t('comment')}>
          {order.rating?.comment ? (
            `“${order.rating.comment}”`
          ) : (
            <span className="text-text-muted">{t('noComment')}</span>
          )}
        </Field>
      </Fields>
    </Section>
  );
}

function ConsigneeSection({ props }: { props: OrderScreenProps }) {
  const { order, viewer, customer } = props;
  const t = useTranslations('orderDetail.consignee');
  const tc = useTranslations('customers');
  const locale = useLocale();
  const area = order.area
    ? [localized(order.area, locale), order.area.parent && localized(order.area.parent, locale)]
        .filter(Boolean)
        .join(' · ')
    : order.zone
      ? localized(order.zone, locale)
      : '–';
  return (
    <Section title={t('title')}>
      <Fields>
        <Field label={t('name')}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-semibold">{order.customerName}</span>
            {customer && (
              <Tag tone={RISK_TONE[customer.risk.level]}>
                {tc(`riskLevels.${customer.risk.level}`)}
              </Tag>
            )}
          </span>
        </Field>
        <Field label={t('phone')}>
          {viewer === 'admin' ? (
            <a href={`tel:${order.customerPhone}`} className="ltr-iso font-bold text-link">
              {order.customerPhone}
            </a>
          ) : (
            <span className="ltr-iso">{order.customerPhone}</span>
          )}
          {order.phoneFlagged && (
            <span className="block text-caption text-status-needs-action">{t('phoneFlagged')}</span>
          )}
        </Field>
      </Fields>
      <Fields>
        <Field label={t('address')} wide>
          {order.addressText}
        </Field>
      </Fields>
      <Fields>
        <Field label={t('area')}>{area}</Field>
        <Field label={t('store')}>
          {localized(order.darkStore, locale)}{' '}
          <span className="ltr-iso text-text-muted">({order.darkStore.code})</span>
        </Field>
      </Fields>
      {customer && (
        <Fields>
          <Field label={t('insight')} wide>
            {customer.risk.attempts > 0
              ? t('insightLine', {
                  pct: 100 - customer.risk.pct,
                  attempts: customer.risk.attempts,
                  failed: customer.risk.failed,
                })
              : t('insightNone')}
          </Field>
        </Fields>
      )}
    </Section>
  );
}

function ShipmentSection({ props }: { props: OrderScreenProps }) {
  const { order } = props;
  const t = useTranslations('orderDetail.shipment');
  const locale = useLocale();
  const live = order.items.filter((i) => i.quantity - i.cancelledQty > 0);
  const units = live.reduce((s, i) => s + i.quantity - i.cancelledQty, 0);
  const pictures = order.items.filter((i) => i.imageUrl);
  return (
    <Section title={t('title')}>
      <Fields>
        <Field label={t('type')}>{t('express')}</Field>
        <Field label={t('items')}>
          <span className="ltr-iso">{units}</span>
        </Field>
      </Fields>
      <Fields>
        <Field label={t('description')} wide>
          {live.map((i) => `[${i.quantity - i.cancelledQty}] × ${title(i, locale)}`).join(', ')}
          {order.items
            .filter((i) => i.cancelledQty > 0)
            .map((i) => (
              <span key={i.skuId} className="block text-caption font-bold text-danger">
                {title(i, locale)}: {t('cancelled', { n: i.cancelledQty })}
              </span>
            ))}
        </Field>
      </Fields>
      <Fields>
        <Field label={t('images')} wide>
          {pictures.length === 0 ? (
            <span className="text-text-muted">{t('noImages')}</span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {pictures.map((i) => (
                // Shopify's own picture of the product (cdn.shopify.com).
                <img
                  key={i.skuId}
                  src={i.imageUrl ?? ''}
                  alt={title(i, locale)}
                  loading="lazy"
                  className="h-14 w-14 rounded-md border border-line bg-surface-raised object-cover"
                />
              ))}
            </span>
          )}
        </Field>
      </Fields>
    </Section>
  );
}

function AdditionalSection({ props }: { props: OrderScreenProps }) {
  const { order, viewer } = props;
  const t = useTranslations('orderDetail.additional');
  const locale = useLocale();
  const ref = shopifyRef(order.shopifyOrderId);
  return (
    <Section title={t('title')}>
      <Fields>
        <Field label={t('returnTo')}>{localized(order.darkStore, locale)}</Field>
        <Field label={t('reference')}>
          {t(`sources.${order.source}`)}
          {ref && <span className="ltr-iso"> #{ref}</span>}
        </Field>
      </Fields>
      <Fields>
        <Field label={t('notes')} wide>
          {order.customerNote || <span className="text-text-muted">{t('noNotes')}</span>}
        </Field>
      </Fields>
      {(viewer === 'admin' || order.trackingToken) && (
        <Fields>
          {viewer === 'admin' && <Field label={t('merchant')}>{order.merchant.name}</Field>}
          {order.trackingToken && (
            <Field label={t('tracking')}>
              <a
                href={`/t/${order.trackingToken}`}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-link underline"
              >
                {t('openTracking')}
              </a>
            </Field>
          )}
        </Fields>
      )}
    </Section>
  );
}

/** The details tab: one banner, the four sections on the wide side, notes and money beside. */
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
      <OrderColumns
        main={
          <>
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
            <OperationSection props={props} />
            <ConsigneeSection props={props} />
            <ShipmentSection props={props} />
            <AdditionalSection props={props} />
          </>
        }
        side={
          <>
            <NotesCard props={props} />
            <CollectionCard props={props} />
          </>
        }
      />
    </div>
  );
}
