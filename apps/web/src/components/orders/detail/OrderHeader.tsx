'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { OrderStatusChip, TINT } from '../OrderStatusChip';
import type { OrderScreenProps } from './types';

export type MenuAction = 'cancel' | 'decide';

/** "Thursday, 6 Nov 2026, 14:05" in Cairo time, Latin digits. */
export function longDateTime(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-bold ${TINT} text-status-needs-action`}
    >
      <Icon name="alert" size={14} />
      {children}
    </span>
  );
}

/**
 * The order page header: number, status pill and the chips that need attention, who created
 * it and when, and the actions (summary, more, print label) on the end side.
 */
export function OrderHeader({
  props,
  onAction,
}: {
  props: OrderScreenProps;
  onAction(action: MenuAction): void;
}) {
  const { order, viewer, basePath, cancellable, ticketHref, customer } = props;
  const t = useTranslations('orderDetail');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const failedAttempts = order.deliveries.filter((d) => d.status === 'failed').length;
  const waitingOpen =
    order.status === 'new' && order.slaStartsAt && new Date(order.slaStartsAt) > new Date();
  const creator =
    order.createdBy ?? (order.source === 'shopify' ? t('createdByShopify') : t('createdBySystem'));
  const trackingUrl =
    order.trackingToken && typeof window !== 'undefined'
      ? `${window.location.origin}/t/${order.trackingToken}`
      : null;

  async function copyLink() {
    if (!trackingUrl) return;
    await navigator.clipboard?.writeText(trackingUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-start text-body-sm hover:bg-surface-raised';
  const items: React.ReactNode[] = [];
  if (order.status === 'attempt_failed')
    items.push(
      <button
        key="decide"
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          setOpen(false);
          onAction('decide');
        }}
      >
        <Icon name="returns" size={16} />
        {t('menu.decide')}
      </button>,
    );
  if (viewer === 'admin' && order.trackingToken) {
    items.push(
      <button
        key="copy"
        type="button"
        role="menuitem"
        className={item}
        onClick={() => void copyLink()}
      >
        <Icon name="tracking" size={16} />
        {copied ? t('menu.copied') : t('menu.copyTracking')}
      </button>,
      <a
        key="open"
        role="menuitem"
        className={item}
        href={`/t/${order.trackingToken}`}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="route" size={16} />
        {t('menu.openTracking')}
      </a>,
    );
  }
  if (customer)
    items.push(
      <Link
        key="customer"
        role="menuitem"
        className={item}
        href={`/admin/customers/${customer.id}`}
      >
        <Icon name="customers" size={16} />
        {t('menu.customer')}
      </Link>,
    );
  if (ticketHref)
    items.push(
      <Link key="ticket" role="menuitem" className={item} href={ticketHref}>
        <Icon name="chat" size={16} />
        {t('menu.ticket')}
      </Link>,
    );
  if (cancellable)
    items.push(
      <button
        key="cancel"
        type="button"
        role="menuitem"
        className={`${item} text-danger`}
        onClick={() => {
          setOpen(false);
          onAction('cancel');
        }}
      >
        <Icon name="alert" size={16} />
        {t('menu.cancel')}
      </button>,
    );

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h2">
            {t('title')} <span className="ltr-iso">{order.number}</span>
          </h1>
          <OrderStatusChip status={order.status} late={order.stage?.late} />
          {order.phoneFlagged && <Chip>{t('chips.phone')}</Chip>}
          {waitingOpen && <Chip>{t('chips.waitingOpen')}</Chip>}
          {failedAttempts > 0 && order.status !== 'attempt_failed' && (
            <Chip>{t('chips.attempts', { count: failedAttempts })}</Chip>
          )}
        </div>
        <p className="text-body-sm text-text-muted">
          {t.rich('created', {
            date: longDateTime(order.placedAt, locale),
            who: creator,
            when: (chunks) => <span className="ltr-iso">{chunks}</span>,
          })}
          {viewer === 'admin' && <> · {order.merchant.name}</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`${basePath}/${order.id}/summary`} className="btn-secondary">
          <Icon name="invoice" size={16} />
          {t('summary')}
        </Link>
        {items.length > 0 && (
          <div ref={menu} className="relative">
            <button
              type="button"
              className="btn-secondary"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {t('more')}
              <span aria-hidden>▾</span>
            </button>
            {open && (
              <div
                role="menu"
                className="absolute end-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
              >
                {items}
              </div>
            )}
          </div>
        )}
        <Link href={`${basePath}/${order.id}/label`} className="btn-primary">
          <Icon name="print" size={16} />
          {t('printLabel')}
        </Link>
      </div>
    </header>
  );
}
