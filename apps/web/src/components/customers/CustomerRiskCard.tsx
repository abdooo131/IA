import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { apiGet } from '@/lib/api-server';
import type { Risk } from '@/lib/customer-types';

const TONE: Record<Risk['level'], string> = {
  unknown: 'border-line',
  low: 'border-status-delivered',
  medium: 'border-status-needs-action',
  high: 'border-danger',
};

/** On admin's order page: who the customer is across merchants and how safe cash is with them. */
export async function CustomerRiskCard({ orderId }: { orderId: string }) {
  const [data, t] = await Promise.all([
    apiGet<{ customer: { id: string; name: string; phone: string | null } | null; risk?: Risk }>(
      `/admin/customers/by-order/${orderId}`,
    ),
    getTranslations('customers'),
  ]);
  if (!data.customer || !data.risk) return null;
  const r = data.risk;
  return (
    <section className={`mt-4 rounded-lg border-s-4 border bg-surface p-4 ${TONE[r.level]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3">{t('riskTitle')}</h2>
        <Link
          href={`/admin/customers/${data.customer.id}`}
          className="text-body-sm font-bold text-link"
        >
          {t('openProfile')}
        </Link>
      </div>
      <p className="mt-1 text-body-sm">
        <strong>{t(`riskLevels.${r.level}`)}</strong>
        {' · '}
        {t('riskLine', { attempts: r.attempts, failed: r.failed, refused: r.refused, pct: r.pct })}
      </p>
    </section>
  );
}
