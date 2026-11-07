import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatCairoDateTime } from '@/lib/format';
import type { TransferListItem } from '@/lib/transfer-types';
import { TransferRoute } from './TransferRoute';
import { TransferStatusChip } from './TransferStatusChip';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export function TransfersTable({ rows, linkBase }: { rows: TransferListItem[]; linkBase: string }) {
  const t = useTranslations('transfers');
  const locale = useLocale();
  if (rows.length === 0) return <p className="mt-6 text-body text-text-muted">{t('empty')}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[760px] text-body-sm">
        <thead className="border-b border-line bg-surface-raised">
          <tr>
            <th className={th}>{t('reference')}</th>
            <th className={th}>{t('route')}</th>
            <th className={th}>{t('status')}</th>
            <th className={`${th} text-end`}>{t('units')}</th>
            <th className={th}>{t('created')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className={td}>
                <Link
                  href={`${linkBase}/${r.id}`}
                  className="ltr-iso font-bold text-link underline"
                >
                  {r.reference}
                </Link>
                {r.origin === 'refill' && (
                  <span className="ms-2 text-caption text-text-muted">{t('auto')}</span>
                )}
              </td>
              <td className={td}>
                <TransferRoute from={r.from} to={r.to} finalDestination={r.finalDestination} />
              </td>
              <td className={td}>
                <TransferStatusChip status={r.status} />
              </td>
              <td className={`${td} ltr-iso text-end`}>
                {r.status === 'received'
                  ? `${r.receivedUnits}/${r.pickedUnits}`
                  : `${r.pickedUnits}/${r.units}`}
              </td>
              <td className={`${td} ltr-iso`}>{formatCairoDateTime(r.createdAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
