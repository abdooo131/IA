'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatEgp } from '@/lib/format';
import type { OrderMoney } from '@/lib/order-types';
import { CashCycle, FeeLines, SideBox, SideCard } from '../page/OrderLayout';
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

/** What the rider collects, what the order is worth, the fees the ledger booked and the payout. */
export function CollectionCard({ props }: { props: OrderScreenProps }) {
  const { order, money } = props;
  const t = useTranslations('orderDetail.collection');
  const tc = useTranslations('orderDetail.cycle');
  const locale = useLocale();
  const products = order.items.reduce(
    (s, i) => s + (i.quantity - i.cancelledQty) * i.unitPricePiastres,
    0,
  );
  const p = money?.payout ?? null;
  const number = p && p.status !== 'next' ? `PAY-${String(p.number).padStart(6, '0')}` : '';
  return (
    <>
      <SideCard>
        <SideBox
          label={t('title')}
          value={
            <span className="ltr-iso">
              {egp(order.codAmountPiastres)}
              {money?.codCreditedPiastres != null &&
                ` · ${t('collected')} ${egp(money.codCreditedPiastres)}`}
            </span>
          }
        />
        <SideBox
          label={t('paymentBox')}
          value={order.paymentMethod === 'cod' ? t('codHint') : t('prepaidHint')}
        />
        <SideBox
          label={t('productValueBox')}
          value={
            <span className="ltr-iso">
              {egp(products)}
              {order.deliveryFeePiastres > 0 &&
                ` + ${t('deliveryFee')} ${egp(order.deliveryFeePiastres)}`}
            </span>
          }
        />
        {money && (
          <FeeLines
            empty={t('noFees')}
            lines={[
              ...money.fees.map((f) => ({
                label: `${t(`kinds.${f.kind}`)} ${percent(f.percentBp)}`.trim(),
                value: egp(f.amountPiastres),
              })),
              ...(money.fees.length > 0
                ? [{ label: t('vat'), value: egp(money.vatPiastres) }]
                : []),
            ]}
            total={
              money.fees.length > 0
                ? { label: t('totalFees'), value: egp(money.duesPiastres) }
                : undefined
            }
          />
        )}
      </SideCard>
      {money && (
        <CashCycle
          title={tc('title')}
          day={
            p?.status === 'next'
              ? dayName(p.day, locale)
              : p?.status === 'paid' && p.paidAt
                ? dayName(p.paidAt.slice(0, 10), locale)
                : undefined
          }
          status={{
            label: tc('status'),
            value:
              p?.status === 'paid'
                ? tc('paid')
                : p?.status === 'draft'
                  ? tc('draft')
                  : tc('unpaid'),
            paid: p?.status === 'paid',
          }}
          rows={[
            {
              label: tc('payout'),
              value: p ? (
                number ? (
                  <span className="ltr-iso">
                    {number}
                    {p.status === 'paid' && p.reference ? ` · ${p.reference}` : ''}
                  </span>
                ) : (
                  payoutHint(money, t, locale)
                )
              ) : (
                t('wallet.notYet')
              ),
            },
            {
              label: t(props.viewer === 'merchant' ? 'wallet.labelMerchant' : 'wallet.label'),
              value: (
                <span className="ltr-iso font-bold">
                  {`${money.netPiastres < 0 ? '−' : ''}EGP ${formatEgp(Math.abs(money.netPiastres))}`}
                </span>
              ),
            },
            ...(money.payoutSchedule
              ? [
                  {
                    label: tc('frequency'),
                    value: tc.has(`schedules.${money.payoutSchedule}`)
                      ? tc(`schedules.${money.payoutSchedule}`)
                      : money.payoutSchedule,
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
