import { PROPOSAL_STATUSES } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ProposalStatusPill } from '@/components/sales/ProposalPanel';
import { apiGet } from '@/lib/api-server';
import { formatEgp } from '@/lib/format';
import type { SalesMeta } from '@/lib/sales';
import { bpText, type ProposalRow } from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';

/**
 * Sales > Proposals: every proposal the person may see, newest first, by status. Managers get
 * a tab of discounts waiting for their approval. Each opens on its deal.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; approval?: string }>;
}) {
  const q = await searchParams;
  const status = (PROPOSAL_STATUSES as readonly string[]).includes(q.status ?? '')
    ? q.status
    : undefined;
  const approval = q.approval === '1';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (approval) params.set('needsApproval', 'true');
  const [rows, meta, t] = await Promise.all([
    apiGet<ProposalRow[]>(`/sales/proposals${params.size ? `?${params}` : ''}`),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales.proposals'),
  ]);
  const tab = (on: boolean) =>
    `rounded-md px-3 py-2 text-body-sm font-bold ${on ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  const tabs: { href: string; label: string; on: boolean }[] = [
    { href: '/admin/sales/proposals', label: t('all'), on: !status && !approval },
    ...(meta.me.level === 'manage'
      ? [{ href: '/admin/sales/proposals?approval=1', label: t('toApprove'), on: approval }]
      : []),
    ...(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'] as const).map((s) => ({
      href: `/admin/sales/proposals?status=${s}`,
      label: t(`statuses.${s}`),
      on: status === s,
    })),
  ];
  return (
    <>
      <h1 className="text-h2">{t('listTitle')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('listIntro')}</p>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('filter')}>
        {tabs.map((x) => (
          <Link
            key={x.href}
            href={x.href}
            className={tab(x.on)}
            aria-current={x.on ? 'page' : undefined}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="mt-6 text-body-sm text-text-muted">{t('listEmpty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('number')}</th>
                <th className={th}>{t('company')}</th>
                <th className={th}>{t('status')}</th>
                <th className={th}>{t('orderFee')}</th>
                <th className={`${th} text-end`}>{t('exampleTotal')}</th>
                <th className={th}>{t('validUntilShort')}</th>
                <th className={th}>{t('owner')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className={td}>
                    <Link href={`/admin/sales/deals/${p.deal.id}#proposals`} className="text-link">
                      <span className="ltr-iso">{p.label}</span>
                    </Link>
                    <span className="block text-caption text-text-muted">
                      <span className="ltr-iso">{p.deal.label}</span> ·{' '}
                      {t('version', { n: p.version })}
                    </span>
                  </td>
                  <td className={`${td} [overflow-wrap:anywhere]`}>{p.deal.company.brandName}</td>
                  <td className={td}>
                    <ProposalStatusPill status={p.status} />
                    {p.needsApproval && !p.approvedAt && p.status === 'draft' && (
                      <span className="mt-1 block text-caption font-bold text-status-needs-action">
                        {t('discountOver', { discount: bpText(p.maxDiscountBp) })}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    <span className="ltr-iso">
                      {formatEgp(p.fees.orderFixedPiastres)} + {bpText(p.fees.orderPercentBp)}%
                    </span>
                  </td>
                  <td className={`${td} text-end tabular`}>
                    {p.example.orders > 0 ? formatEgp(p.example.totalPiastres) : '–'}
                  </td>
                  <td className={td}>
                    <span className="ltr-iso">{p.validUntil ?? '–'}</span>
                  </td>
                  <td className={td}>{p.deal.owner?.name ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
