import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { DepositForm } from '@/components/finance/Contracts';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

interface ContractRow {
  merchant: { id: string; name: string };
  contract: string;
  /** The version in force today, for example CTR-000001 v2 (null: none yet) */
  version: string | null;
  hasDraft: boolean;
  ownPrices: number;
  startDate: string | null;
  endDate: string | null;
  noticeBy: string | null;
  inForce: boolean;
  tiers: number;
  minimumMonthlyFeePiastres: number | null;
  securityDepositPiastres: number | null;
  depositHeldPiastres: number;
  creditLimitPiastres: number | null;
  owedPiastres: number;
  overCreditLimit: boolean;
}

/** Merchant contracts as Accounting sees them, with the deposits held and received here. */
export default async function FinanceContractsPage() {
  const [rows, profile, t] = await Promise.all([
    apiGet<ContractRow[]>('/finance/contracts'),
    getMyProfile(),
    getTranslations('finance.contracts'),
  ]);
  const canUse = canDo(profile, 'accounting', 'use');
  const canOpen = canDo(profile, 'merchants', 'view');
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';
  const money = (v: number | null) => (v === null ? '–' : <Amount piastres={v} />);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      {rows.length === 0 ? (
        <p className="mt-6 text-body-sm text-text-muted">{t('none')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('merchant')}</th>
                <th className={th}>{t('period')}</th>
                <th className={`${th} text-end`}>{t('minimum')}</th>
                <th className={`${th} text-end`}>{t('deposit')}</th>
                <th className={`${th} text-end`}>{t('held')}</th>
                <th className={`${th} text-end`}>{t('creditLimit')}</th>
                <th className={`${th} text-end`}>{t('owed')}</th>
                {canUse && <th className={th}>{t('depositAction')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.merchant.id} className="border-t border-line">
                  <td className={td}>
                    {canOpen ? (
                      <Link
                        href={`/admin/merchants/${r.merchant.id}`}
                        className="font-bold text-link"
                      >
                        {r.merchant.name}
                      </Link>
                    ) : (
                      r.merchant.name
                    )}
                    <span className="ltr-iso block text-caption text-text-muted">
                      {r.version ?? r.contract}
                      {r.hasDraft && ` · ${t('draft')}`}
                    </span>
                    {r.overCreditLimit && (
                      <span className="block text-caption font-bold text-danger">
                        {t('overLimit')}
                      </span>
                    )}
                  </td>
                  <td className={`${td} ltr-iso`}>
                    {r.startDate ? isoToDayFirst(r.startDate) : '–'} →{' '}
                    {r.endDate ? isoToDayFirst(r.endDate) : t('noEnd')}
                    {r.noticeBy && (
                      <span className="block text-caption text-text-muted">
                        {t('noticeBy')}: {isoToDayFirst(r.noticeBy)}
                      </span>
                    )}
                  </td>
                  <td className={`${td} text-end`}>{money(r.minimumMonthlyFeePiastres)}</td>
                  <td className={`${td} text-end`}>{money(r.securityDepositPiastres)}</td>
                  <td className={`${td} text-end`}>{money(r.depositHeldPiastres)}</td>
                  <td className={`${td} text-end`}>{money(r.creditLimitPiastres)}</td>
                  <td className={`${td} text-end`}>{money(r.owedPiastres)}</td>
                  {canUse && (
                    <td className={td}>
                      <DepositForm merchantId={r.merchant.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
