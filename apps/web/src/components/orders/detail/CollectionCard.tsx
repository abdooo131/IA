'use client';

import { useLocale, useTranslations } from 'next-intl';
import { WalletCard } from '@/components/WalletCard';
import { formatEgp } from '@/lib/format';
import type { OrderMoney } from '@/lib/order-types';
import { Card, Row } from './Card';
import type { OrderScreenProps } from './types';

const egp = (piastres: number) => `EGP ${formatEgp(piastres)}`;
const percent = (bp: number | null) =>
  bp === null ? '' : `${(bp / 100).toLocaleString('en-US')}%`;

/** "Sunday 9 Nov" for a YYYY-MM-DD payout day. */
function dayName(day: string, locale: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' },
  );
}

function payoutHint(money: OrderMoney, t: ReturnType<typeof useTranslations>, locale: string) {
  const p = money.payout;
  if (!p) return t('wallet.notYet');
  if (p.status === 'paid')
    return t('wallet.paid', {
      number: `PAY-${String(p.number).padStart(6, '0')}`,
      reference: p.reference ?? '–',
    });
  if (p.status === 'draft')
    return t('wallet.draft', { number: `PAY-${String(p.number).padStart(6, '0')}` });
  return t('wallet.next', { day: dayName(p.day, locale) });
}

/** What the rider collects, what the order is worth, and the fees the ledger booked for it. */
export function CollectionCard({ props }: { props: OrderScreenProps }) {
  const { order, money, viewer } = props;
  const t = useTranslations('orderDetail.collection');
  const locale = useLocale();
  const products = order.items.reduce(
    (s, i) => s + (i.quantity - i.cancelledQty) * i.unitPricePiastres,
    0,
  );
  return (
    <>
      <Card title={t('title')} icon="cash">
        <p className="tabular ltr-iso text-number-lg">{egp(order.codAmountPiastres)}</p>
        <p className="text-caption text-text-muted">
          {order.paymentMethod === 'cod' ? t('codHint') : t('prepaidHint')}
        </p>
        <dl className="mt-3">
          <Row label={t('method')}>{t(order.paymentMethod === 'cod' ? 'cod' : 'prepaid')}</Row>
          <Row label={t('products')}>
            <span className="ltr-iso">{egp(products)}</span>
          </Row>
          <Row label={t('deliveryFee')}>
            <span className="ltr-iso">{egp(order.deliveryFeePiastres)}</span>
          </Row>
          {money?.codCreditedPiastres != null && (
            <Row label={t('collected')}>
              <span className="ltr-iso">{egp(money.codCreditedPiastres)}</span>
            </Row>
          )}
        </dl>
      </Card>
      {money && (
        <Card title={t('fees')} icon="invoice">
          {money.fees.length === 0 ? (
            <p className="text-caption text-text-muted">{t('noFees')}</p>
          ) : (
            <dl>
              {money.fees.map((f, i) => (
                <Row
                  key={`${f.kind}-${i}`}
                  label={`${t(`kinds.${f.kind}`)} ${percent(f.percentBp)}`.trim()}
                >
                  <span className="ltr-iso">{egp(f.amountPiastres)}</span>
                </Row>
              ))}
              <Row label={t('vat')}>
                <span className="ltr-iso">{egp(money.vatPiastres)}</span>
              </Row>
              <Row label={t('dues')} strong>
                <span className="ltr-iso">{egp(money.duesPiastres)}</span>
              </Row>
            </dl>
          )}
        </Card>
      )}
      {money && (money.payout || money.fees.length > 0) && (
        <WalletCard
          icon="wallet"
          label={t(viewer === 'merchant' ? 'wallet.labelMerchant' : 'wallet.label')}
          value={`${money.netPiastres < 0 ? '−' : ''}EGP ${formatEgp(Math.abs(money.netPiastres))}`}
          hint={payoutHint(money, t, locale)}
        />
      )}
    </>
  );
}
