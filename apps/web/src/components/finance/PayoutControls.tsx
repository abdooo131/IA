'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { PayoutControlsData } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';
import { ProofUpload } from './ProofUpload';

const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const link = 'text-body-sm font-bold text-link';

/**
 * A payout's statement of account, proof of transfer and checks: what must be in place before
 * it is marked paid. The statement is frozen when the payout is prepared; the proof is the
 * bank slip; the second person check is confirmed by someone other than the payer.
 */
export function PayoutControls({
  data,
  canWrite,
}: {
  data: PayoutControlsData;
  canWrite: boolean;
}) {
  const t = useTranslations('finance.payoutControls');
  const locale = useLocale();
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/finance/payouts/${data.payoutId}`;
  const draft = data.status === 'draft';

  async function tick(checkId: string) {
    setBusy(checkId);
    setError(null);
    const r = await apiSend('POST', `/finance/payouts/${data.payoutId}/checks/${checkId}`, {
      note: notes[checkId]?.trim() || undefined,
    });
    setBusy(null);
    if (!r.ok)
      return setError(t(t.has(`errors.${r.error}`) ? `errors.${r.error}` : 'errors.generic'));
    router.refresh();
  }

  return (
    <section
      id="payout-controls"
      className="space-y-4 rounded-lg border border-line bg-surface p-4"
      aria-labelledby="payout-controls-title"
    >
      <div>
        <h2 id="payout-controls-title" className="text-h3">
          {t('title')}
        </h2>
        <p className="mt-1 text-caption text-text-muted">{t('intro')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Statement of account */}
        <div className="space-y-2 rounded-md border border-line p-3">
          <h3 className="text-label font-bold uppercase text-text-muted">{t('soa')}</h3>
          {data.soa ? (
            <>
              <p className="ltr-iso font-bold">{data.soa.number}</p>
              <p className="ltr-iso text-caption text-text-muted">
                {t('period', { from: data.soa.fromDay, to: data.soa.toDay })}
              </p>
              <dl className="grid grid-cols-2 gap-1 text-body-sm">
                <dt className="text-text-muted">{t('opening')}</dt>
                <dd className="text-end">
                  <Amount piastres={data.soa.openingPiastres} />
                </dd>
                <dt className="text-text-muted">{t('closing')}</dt>
                <dd className="text-end">
                  <Amount piastres={data.soa.closingPiastres} />
                </dd>
                {data.soa.heldBackPiastres !== 0 && (
                  <>
                    <dt className="text-text-muted">{t('heldBack')}</dt>
                    <dd className="text-end">
                      <Amount piastres={0 - data.soa.heldBackPiastres} />
                    </dd>
                  </>
                )}
                <dt className="font-bold">{t('net')}</dt>
                <dd className="text-end">
                  <Amount piastres={data.soa.netPiastres} strong />
                </dd>
              </dl>
              <p className="flex flex-wrap gap-3">
                <a className={link} href={`${base}/statement.pdf?lang=en`}>
                  {t('pdfEn')}
                </a>
                <a className={link} href={`${base}/statement.pdf?lang=ar`}>
                  {t('pdfAr')}
                </a>
                <a className={link} href={`${base}/statement.csv`}>
                  {t('csv')}
                </a>
              </p>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{t('soaMissing')}</p>
          )}
        </div>

        {/* Proof of transfer */}
        <div className="space-y-2 rounded-md border border-line p-3">
          <h3 className="text-label font-bold uppercase text-text-muted">{t('pot')}</h3>
          {data.pot ? (
            <>
              <p className="ltr-iso font-bold">{data.pot.number}</p>
              <dl className="grid grid-cols-2 gap-1 text-body-sm">
                <dt className="text-text-muted">{t('amount')}</dt>
                <dd className="text-end">
                  <Amount piastres={data.pot.amountPiastres} strong />
                </dd>
                <dt className="text-text-muted">{t('reference')}</dt>
                <dd className="ltr-iso text-end">{data.pot.reference}</dd>
              </dl>
              <p className="text-caption text-text-muted">
                {t('uploadedBy', {
                  name: data.pot.uploadedBy,
                  time: formatCairoDateTime(data.pot.uploadedAt, locale),
                })}
              </p>
              <a className={link} href={`${base}/proof`} target="_blank" rel="noreferrer">
                {t('viewSlip')}
              </a>
            </>
          ) : data.cheque ? (
            <p className="text-body-sm">
              {t('paidByCheque')}{' '}
              <a href={`/finance/cheques/${data.cheque.id}`} className={`${link} ltr-iso`}>
                {data.cheque.number} · {data.cheque.chequeNumber}
              </a>
              {draft && (
                <span className="mt-1 block text-caption text-text-muted">
                  {t('chequeWaitsForChecks')}
                </span>
              )}
            </p>
          ) : (
            <p className="text-body-sm text-text-muted">{t('potMissing')}</p>
          )}
          {draft && canWrite && !data.cheque && (
            <details className="pt-2" open={!data.pot}>
              <summary className="cursor-pointer text-body-sm font-bold text-link">
                {data.pot ? t('replace') : t('upload')}
              </summary>
              <div className="pt-2">
                <ProofUpload
                  payoutId={data.payoutId}
                  amountPiastres={data.amountPiastres}
                  replacing={!!data.pot}
                />
              </div>
            </details>
          )}
        </div>
      </div>

      <p
        className={`rounded-md px-3 py-2 text-body-sm font-bold ${data.matches ? 'border border-status-delivered text-text' : 'border border-line bg-surface-raised text-text-muted'}`}
      >
        {data.matches ? `✓ ${t('matches')}` : t('differs')}
      </p>

      {/* Checks */}
      <div className="space-y-2">
        <h3 className="text-label font-bold uppercase text-text-muted">{t('checks')}</h3>
        <ul className="divide-y divide-line rounded-md border border-line">
          {data.checks.map((c) => (
            <li key={c.id} className="space-y-2 px-3 py-2 text-body-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {c.mark ? '✓ ' : ''}
                  {locale === 'ar' ? c.labelAr : c.labelEn}
                </span>
                <span className="text-caption text-text-muted">
                  {c.mark
                    ? t('tickedBy', {
                        name: c.mark.by,
                        time: formatCairoDateTime(c.mark.at, locale),
                      })
                    : t('notTicked')}
                </span>
              </div>
              {c.system && <p className="text-caption text-text-muted">{t('secondPersonHint')}</p>}
              {c.mark?.note && <p className="text-caption">{c.mark.note}</p>}
              {!c.mark && draft && canWrite && (
                <div className="flex flex-wrap gap-2">
                  <input
                    value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                    placeholder={t('note')}
                    aria-label={t('note')}
                    className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-body-sm"
                  />
                  <button
                    type="button"
                    className={button}
                    disabled={busy !== null}
                    onClick={() => void tick(c.id)}
                  >
                    {t('tick')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p role="status" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {draft && (
        <ul className="space-y-1 text-body-sm">
          {data.blockers.length === 0 ? (
            <li className="font-bold">{t('ready')}</li>
          ) : (
            data.blockers.map((b) => (
              <li key={b} className="text-text-muted">
                {t.has(`blockers.${b}`) ? t(`blockers.${b}`) : b}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
