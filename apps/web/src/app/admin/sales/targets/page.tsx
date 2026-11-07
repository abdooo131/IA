import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SalesMonthForm } from '@/components/sales/SalesMonthForm';
import { TargetsEditor } from '@/components/sales/TargetsEditor';
import { apiGet } from '@/lib/api-server';
import type { SalesMeta } from '@/lib/sales';
import { pickMonth, type TargetsView } from '@/lib/sales-part2';

export const dynamic = 'force-dynamic';

/**
 * Sales > Targets: each rep's month, deals won, delivered orders and counted fees (before VAT)
 * of the merchants they won, against the targets the sales managers set here, with the month's
 * commission standing (hit or missed, merchants still pending). Managers see which reps have no
 * fees target for the current and the next month.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const month = pickMonth(q.month, cairoDay(new Date()).slice(0, 7));
  const current = cairoDay(new Date()).slice(0, 7);
  const [data, meta, t] = await Promise.all([
    apiGet<TargetsView>(`/sales/targets?month=${month}`),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales.targets'),
  ]);
  const missing = data.missingTargets.filter((m) => m.users.length > 0);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      {missing.length > 0 && (
        <div
          role="status"
          className="mt-4 rounded-md bg-status-needs-action/15 p-3 text-body-sm text-status-needs-action"
        >
          <p className="font-bold">{t('missingTitle')}</p>
          <ul className="mt-1 space-y-0.5">
            {missing.map((m) => (
              <li key={m.month}>
                <Link
                  href={`/admin/sales/targets?month=${m.month}`}
                  className="font-semibold underline"
                >
                  <span className="ltr-iso">{m.month}</span>
                </Link>
                : {m.users.map((u) => u.name).join(', ')}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-caption">{t('missingHint')}</p>
        </div>
      )}
      <SalesMonthForm month={month} />
      <TargetsEditor
        rows={data.rows}
        month={month}
        running={month === current}
        canEdit={meta.me.level === 'manage'}
      />
    </>
  );
}
