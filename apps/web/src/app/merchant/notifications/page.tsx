import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { MarkReadButton } from '@/components/merchant/MarkReadButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';
import type { MerchantNotification } from '@/lib/merchant-types';

export const dynamic = 'force-dynamic';

type Store = { nameEn: string; nameAr: string };
type Line = {
  sku: string;
  quantity?: number;
  before?: number;
  after?: number;
  expectedQty?: number;
  receivedQty?: number;
};

const ORDER_TYPES = [
  'order_items_cancelled',
  'order_moved_to_standard',
  'order_cancelled',
  'order_delivered',
  'order_attempt_failed',
  'order_failed',
];

export default async function NotificationsPage() {
  const [notes, t, tReasons, locale] = await Promise.all([
    apiGet<MerchantNotification[]>('/merchant/notifications'),
    getTranslations('merchant.notifications'),
    getTranslations('rider.reasons'),
    getLocale(),
  ]);

  /** The headline, detail lines and link of one notification, by its type. */
  function describe(n: MerchantNotification) {
    const d = n.data;
    const lines = (d.lines as Line[] | undefined) ?? [];
    if (n.type === 'manifest_received' || n.type === 'stock_count_adjusted') {
      const store = d.darkStore ? localized(d.darkStore as Store, locale) : '';
      return {
        title:
          n.type === 'manifest_received'
            ? t('manifest_received', { reference: String(d.reference), store })
            : t('stock_count_adjusted', { store, bin: String(d.bin) }),
        lines: lines.map((l) =>
          n.type === 'manifest_received'
            ? t('received', {
                sku: l.sku,
                received: l.receivedQty ?? 0,
                expected: l.expectedQty ?? 0,
              })
            : t('line', { sku: l.sku, before: l.before ?? 0, after: l.after ?? 0 }),
        ),
        href: null,
      };
    }
    if (ORDER_TYPES.includes(n.type)) {
      const reason = String(d.reason ?? '');
      const vars = {
        number: String(d.number ?? ''),
        attempt: String(d.attempt ?? ''),
        max: String(d.maxAttempts ?? ''),
        reason: tReasons.has(reason) ? tReasons(reason) : reason,
      };
      const extra =
        n.type === 'order_attempt_failed' && typeof d.holdUntil === 'string'
          ? [t('order_attempt_failed_hint', { time: formatCairoDateTime(d.holdUntil, locale) })]
          : [];
      return {
        title: t(n.type, vars),
        lines: [
          ...lines.map((l) => t('cancelledLine', { sku: l.sku, quantity: l.quantity ?? 0 })),
          ...extra,
        ],
        href: typeof d.orderId === 'string' ? `/merchant/orders/${d.orderId}` : null,
      };
    }
    return { title: t('other'), lines: [], href: null };
  }

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      {notes.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((n) => {
            const note = describe(n);
            return (
              <li
                key={n.id}
                className={`rounded-lg border bg-surface p-4 shadow-sm ${n.readAt ? 'border-line' : 'border-primary'}`}
              >
                <p className="text-body font-bold">{note.title}</p>
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">{formatCairoDateTime(n.createdAt, locale)}</span>
                </p>
                {note.lines.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-body-sm">
                    {note.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {note.href && (
                    <Link href={note.href} className="text-body-sm text-link underline">
                      {t('openOrder')}
                    </Link>
                  )}
                  {!n.readAt && <MarkReadButton id={n.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
