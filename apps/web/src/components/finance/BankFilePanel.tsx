import { payoutNumber } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { Amount } from './Amount';

export interface BankFile {
  ready: { payoutId: string; number: number; merchant: string; amountPiastres: number }[];
  blocked: {
    payoutId: string;
    number: number;
    merchant: string;
    amountPiastres: number;
    reason: string;
  }[];
}

/** Draft payouts as one bulk transfer file for the bank, and the ones that cannot go yet. */
export async function BankFilePanel({ file }: { file: BankFile }) {
  const t = await getTranslations('finance.bankFile');
  const total = file.ready.reduce((s, r) => s + r.amountPiastres, 0);
  if (file.ready.length === 0 && file.blocked.length === 0) return null;
  return (
    <section className="mt-4 space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('title')}</h2>
      <p className="text-caption text-text-muted">{t('hint')}</p>
      {file.ready.length > 0 && (
        <p className="text-body-sm">
          {t('ready', { count: file.ready.length })} · <Amount piastres={total} strong />
        </p>
      )}
      {file.blocked.length > 0 && (
        <ul className="list-disc ps-5 text-body-sm text-danger">
          {file.blocked.map((b) => (
            <li key={b.payoutId}>
              <span className="ltr-iso">{payoutNumber(b.number)}</span> {b.merchant}:{' '}
              {t(`reasons.${b.reason}`)}
            </li>
          ))}
        </ul>
      )}
      {file.ready.length > 0 && (
        <a
          href="/api/finance/payouts/bank-file.csv"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-bold text-on-primary"
        >
          {t('download')}
        </a>
      )}
    </section>
  );
}
