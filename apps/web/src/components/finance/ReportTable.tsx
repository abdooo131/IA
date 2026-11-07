import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from './Amount';

interface Line {
  id?: string;
  code: string;
  nameEn: string;
  nameAr: string;
  amountPiastres: number;
  wallets?: number;
}

/** One section of a report: a line per account and a total. */
export async function ReportTable({
  title,
  lines,
  totalLabel,
  total,
  extra,
}: {
  title: string;
  lines: Line[];
  totalLabel: string;
  total: number;
  extra?: { label: string; amount: number };
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('finance.reports')]);
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      <table className="mt-2 w-full text-body-sm">
        <tbody>
          {lines.length === 0 && !extra && (
            <tr>
              <td className="py-1 text-text-muted">{t('nothing')}</td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.code} className="border-b border-line">
              <td className="ltr-iso w-24 py-1 text-text-muted">{l.code}</td>
              <td className="py-1">
                {l.wallets !== undefined ? (
                  t('wallets', { count: l.wallets, group: t(`groups.g${l.code}`) })
                ) : l.id ? (
                  <Link href={`/finance/accounts/${l.id}`} className="text-link">
                    {locale === 'ar' ? l.nameAr || l.nameEn : l.nameEn}
                  </Link>
                ) : locale === 'ar' ? (
                  l.nameAr || l.nameEn
                ) : (
                  l.nameEn
                )}
              </td>
              <td className="py-1 text-end">
                <Amount piastres={l.amountPiastres} />
              </td>
            </tr>
          ))}
          {extra && (
            <tr className="border-b border-line">
              <td />
              <td className="py-1">{extra.label}</td>
              <td className="py-1 text-end">
                <Amount piastres={extra.amount} />
              </td>
            </tr>
          )}
          <tr className="font-bold">
            <td />
            <td className="py-2">{totalLabel}</td>
            <td className="py-2 text-end">
              <Amount piastres={total} strong />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
