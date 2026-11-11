import { type PayoutStatementData, sortKinds } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

/**
 * The statement of account of one of the merchant's payouts, frozen when it was prepared:
 * opening balance, every kind of movement with the VAT inside the fees, each order of the
 * period, other movements, the closing balance and the net transferred.
 */
export default async function MerchantPayoutStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [s, t, tf, locale] = await Promise.all([
    apiGet<PayoutStatementData>(`/merchant/finance/payouts/${id}/statement`),
    getTranslations('merchantFinance'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const kind = (k: string) => (tf.has(`kinds.${k}`) ? tf(`kinds.${k}`) : k);
  const base = `/api/merchant/finance/payouts/${id}`;
  return (
    <>
      <Link href="/merchant/wallet" className="text-body-sm font-bold text-link">
        {t('back')}
      </Link>
      <h1 className="mt-2 text-h2">
        <span className="ltr-iso">{t('soaTitle', { number: s.number })}</span>
      </h1>
      <p className="ltr-iso text-body-sm text-text-muted">
        {t('payoutLabel', { number: s.payout.number })} ·{' '}
        {t('period', { from: s.fromDay, to: s.toDay })}
      </p>
      <p className="text-caption text-text-muted">
        {t('frozen')} {formatCairoDateTime(s.frozenAt, locale)}
      </p>
      <p className="mt-2 flex flex-wrap gap-4 text-body-sm">
        <a className="font-bold text-link" href={`${base}/statement.pdf?lang=en`}>
          {t('pdfEn')}
        </a>
        <a className="font-bold text-link" href={`${base}/statement.pdf?lang=ar`}>
          {t('pdfAr')}
        </a>
        <a className="font-bold text-link" href={`${base}/statement.csv`}>
          {t('csv')}
        </a>
      </p>

      <section className="mt-4 max-w-xl rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('summary')}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-body-sm">
          <dt className="text-text-muted">{t('opening')}</dt>
          <dd className="text-end">
            <Amount piastres={s.openingPiastres} />
          </dd>
          {sortKinds(Object.keys(s.byKind)).map((k) => (
            <div key={k} className="contents">
              <dt className="text-text-muted">{kind(k)}</dt>
              <dd className="text-end">
                <Amount piastres={s.byKind[k]!} />
              </dd>
            </div>
          ))}
          <dt className="text-text-muted">{t('vatIncluded')}</dt>
          <dd className="text-end">
            <Amount piastres={s.vatPiastres} />
          </dd>
          <dt className="text-text-muted">{t('closing')}</dt>
          <dd className="text-end">
            <Amount piastres={s.closingPiastres} />
          </dd>
          {s.heldBackPiastres !== 0 && (
            <>
              <dt className="text-text-muted">{t('heldBack')}</dt>
              <dd className="text-end">
                <Amount piastres={0 - s.heldBackPiastres} />
              </dd>
            </>
          )}
          <dt className="font-bold">{t('net')}</dt>
          <dd className="text-end">
            <Amount piastres={s.netPiastres} strong /> {tf('egp')}
          </dd>
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('orders')}</h2>
        {s.orders.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[560px] text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th className={th}>{t('order')}</th>
                  <th className={`${th} text-end`}>{t('cod')}</th>
                  <th className={`${th} text-end`}>{t('fees')}</th>
                  <th className={`${th} text-end`}>{t('vat')}</th>
                  <th className={`${th} text-end`}>{t('orderNet')}</th>
                </tr>
              </thead>
              <tbody>
                {s.orders.map((o) => (
                  <tr key={o.orderId} className="border-b border-line last:border-0">
                    <td className={`${td} ltr-iso font-bold`}>{o.orderNumber}</td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={o.codPiastres} />
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={Object.values(o.fees).reduce((a, b) => a + b, 0)} />
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={o.vatPiastres} />
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={o.netPiastres} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('other')}</h2>
        {s.other.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[520px] text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th className={th}>{t('day')}</th>
                  <th className={th}>{t('type')}</th>
                  <th className={th}>{t('ref')}</th>
                  <th className={`${th} text-end`}>{tf('egp')}</th>
                </tr>
              </thead>
              <tbody>
                {s.other.map((l, i) => (
                  <tr key={`${l.at}-${i}`} className="border-b border-line last:border-0">
                    <td className={`${td} ltr-iso`}>{formatCairoDateTime(l.at, locale)}</td>
                    <td className={td}>{kind(l.kind)}</td>
                    <td className={`${td} ltr-iso`}>{l.orderNumber ?? l.memo ?? ''}</td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={l.amountPiastres} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
