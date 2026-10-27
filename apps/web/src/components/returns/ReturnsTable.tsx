import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime } from '@/lib/format';
import type { ReturnListItem } from '@/lib/return-types';
import { ReturnStatusChip } from './ReturnStatusChip';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

/** Returns to merchants as a table; each row opens `${linkBase}/<id>`. */
export function ReturnsTable({
  rows,
  linkBase,
  showMerchant = false,
}: {
  rows: ReturnListItem[];
  linkBase: string;
  showMerchant?: boolean;
}) {
  const t = useTranslations('returns');
  const locale = useLocale();
  if (rows.length === 0) return <p className="mt-6 text-body text-text-muted">{t('empty')}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[640px] text-body-sm">
        <thead className="border-b border-line bg-surface-raised">
          <tr>
            <th className={th}>{t('reference')}</th>
            {showMerchant && <th className={th}>{t('merchant')}</th>}
            <th className={th}>{t('store')}</th>
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
              </td>
              {showMerchant && <td className={td}>{r.merchant.name}</td>}
              <td className={td}>{localized(r.darkStore, locale)}</td>
              <td className={td}>
                <ReturnStatusChip status={r.status} />
              </td>
              <td className={`${td} ltr-iso text-end`}>
                {r.pickedUnits}/{r.units}
              </td>
              <td className={`${td} ltr-iso`}>{formatCairoDateTime(r.createdAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
