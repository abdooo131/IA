'use client';

import { MOBILE_WALLETS, type WithdrawalDetails } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { WalletCard } from '@/components/WalletCard';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import {
  detailsText,
  type RiderWalletView,
  type WithdrawalView,
  withdrawalDetailsProblem,
  withdrawalError,
  withdrawalPreview,
  withdrawalProblem,
} from '@/lib/rider-wallet';
import { StatusPill as Pill } from '@/components/StatusPill';

const field = 'h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-body';
const KNOWN_ERRORS = [
  'more_than_available',
  'below_minimum',
  'withdrawal_already_open',
  'invalid_amount',
  'invalid_iban',
  'invalid_phone',
  'invalid_instapay',
  'validation_failed',
  'withdrawal_not_requested',
  'network',
];

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('riderPay.statuses');
  return <Pill status={status}>{t(status)}</Pill>;
}

/** Where the money goes, in words. */
export function MethodText({ details }: { details: WithdrawalDetails }) {
  const t = useTranslations('riderPay');
  const extra = detailsText(details);
  const name =
    details.method === 'mobile_wallet'
      ? t(`wallets.${details.provider}`)
      : t(`methods.${details.method}`);
  return (
    <span className="min-w-0 break-words">
      {name}
      {extra && (
        <>
          {' · '}
          <span className="ltr-iso">{extra}</span>
        </>
      )}
    </span>
  );
}

function egp(t: ReturnType<typeof useTranslations>, piastres: number) {
  return t('amount', { amount: formatEgp(piastres) });
}

/**
 * The rider's wallet (rider app): what they earned, what is on hold and when it frees up, what
 * they owe, the withdrawal form and the history of earnings and withdrawals.
 */
export function RiderWallet({ wallet }: { wallet: RiderWalletView }) {
  const t = useTranslations('riderPay');
  const locale = useLocale();
  const router = useRouter();
  const { totals, owed } = wallet;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Long histories open a page at a time, so the wallet stays short on a phone.
  const [earningsShown, setEarningsShown] = useState(15);
  const [withdrawalsShown, setWithdrawalsShown] = useState(5);

  async function cancel(w: WithdrawalView) {
    setBusy(true);
    const r = await apiSend('POST', `/rider/withdrawals/${w.id}/cancel`, {});
    setBusy(false);
    setMessage(
      r.ok
        ? { text: t('cancelled'), error: false }
        : {
            text: t(`errors.${KNOWN_ERRORS.includes(r.error) ? r.error : 'generic'}`),
            error: true,
          },
    );
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <WalletCard
        large
        icon="wallet"
        label={t('available')}
        value={egp(t, totals.availablePiastres)}
        hint={
          totals.onHoldPiastres > 0
            ? t('onHoldHint', { amount: formatEgp(totals.onHoldPiastres) })
            : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon="delivered"
          tone="delivered"
          label={t('earnedMonth')}
          value={egp(t, totals.earnedMonthPiastres)}
        />
        <StatCard
          icon="schedule"
          tone="in-progress"
          label={t('onHold')}
          value={egp(t, totals.onHoldPiastres)}
        />
        <StatCard
          icon="wallet"
          tone="primary"
          label={t('earnedAll')}
          value={egp(t, totals.earnedAllPiastres)}
        />
        <StatCard
          icon="payout"
          tone={totals.pendingPiastres > 0 ? 'new' : 'primary'}
          label={t('pending')}
          value={egp(t, totals.pendingPiastres)}
        />
      </div>

      <p className="text-body-sm text-text-muted">
        {t('rules', {
          amount: formatEgp(wallet.rules.perDeliveryPiastres),
          days: wallet.rules.holdDays,
        })}
      </p>

      {owed.totalPiastres > 0 && (
        <section
          aria-labelledby="owed"
          className="rounded-lg border border-status-needs-action/40 bg-surface p-4"
        >
          <h2 id="owed" className="text-h3">
            {t('owedTitle', { amount: formatEgp(owed.totalPiastres) })}
          </h2>
          <p className="mt-1 text-body-sm text-text-muted">{t('owedHint')}</p>
          <dl className="mt-3 space-y-1 text-body-sm">
            {owed.duesPiastres > 0 && (
              <div className="flex justify-between gap-3">
                <dt>{t('dues')}</dt>
                <dd className="tabular ltr-iso">{formatEgp(owed.duesPiastres)}</dd>
              </div>
            )}
            {owed.advancePiastres > 0 && (
              <div className="flex justify-between gap-3">
                <dt>{t('advance')}</dt>
                <dd className="tabular ltr-iso">{formatEgp(owed.advancePiastres)}</dd>
              </div>
            )}
          </dl>
          {owed.charges.length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line text-caption">
              {owed.charges.map((c, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    {t.has(`charges.${c.kind}`) ? t(`charges.${c.kind}`) : c.kind}
                    {c.memo && <span className="text-text-muted"> · {c.memo}</span>}
                    <span className="block text-text-muted">
                      {formatCairoDateTime(c.at, locale)}
                    </span>
                  </span>
                  <span className="tabular ltr-iso shrink-0">{formatEgp(c.amountPiastres)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="withdraw" className="space-y-3">
        <h2 id="withdraw" className="text-h3">
          {t('withdrawTitle')}
        </h2>
        {wallet.canRequest === 'withdrawal_already_open' && (
          <p className="text-body-sm text-text-muted">{t('openAlready')}</p>
        )}
        {wallet.canRequest === 'nothing_available' && (
          <p className="text-body-sm text-text-muted">{t('nothingYet')}</p>
        )}
        {!wallet.canRequest && !open && (
          <button
            type="button"
            className="btn-primary h-12 w-full"
            onClick={() => {
              setOpen(true);
              setMessage(null);
            }}
          >
            {t('withdraw')}
          </button>
        )}
        {!wallet.canRequest && open && (
          <WithdrawForm
            wallet={wallet}
            onDone={(text) => {
              setOpen(false);
              setMessage({ text, error: false });
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        )}
        {message && (
          <p
            role="status"
            className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
          >
            {message.text}
          </p>
        )}
      </section>

      <section aria-labelledby="withdrawals" className="space-y-2">
        <h2 id="withdrawals" className="text-h3">
          {t('withdrawals')}
        </h2>
        {wallet.withdrawals.length === 0 && (
          <p className="text-body-sm text-text-muted">{t('noWithdrawals')}</p>
        )}
        <ul className="space-y-2">
          {wallet.withdrawals.slice(0, withdrawalsShown).map((w) => (
            <li key={w.id} className="rounded-lg border border-line bg-surface p-3 text-body-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  <span className="ltr-iso">{w.number}</span> · {egp(t, w.amountPiastres)}
                </span>
                <StatusPill status={w.status} />
              </div>
              <p className="mt-1 text-text-muted">
                <MethodText details={w.details} /> · {formatCairoDateTime(w.createdAt, locale)}
              </p>
              {w.deductionPiastres > 0 && (
                <p className="mt-1">{t('deducted', { amount: formatEgp(w.deductionPiastres) })}</p>
              )}
              {w.status === 'paid' && w.paidAt && (
                <p className="mt-1 text-status-delivered">
                  {t('paidOn', { time: formatCairoDateTime(w.paidAt, locale) })}
                  {w.reference && (
                    <>
                      {' · '}
                      <span className="ltr-iso">{w.reference}</span>
                    </>
                  )}
                </p>
              )}
              {w.status === 'rejected' && (
                <p className="mt-1 text-status-needs-action">
                  {t('rejectedBecause', { reason: w.rejectReason ?? '' })}
                </p>
              )}
              {w.status === 'requested' && (
                <button
                  type="button"
                  disabled={busy}
                  className="btn-secondary mt-2 h-10 px-3"
                  onClick={() => void cancel(w)}
                >
                  {t('cancelRequest')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {wallet.withdrawals.length > withdrawalsShown && (
          <button
            type="button"
            className="btn-secondary h-10 w-full"
            onClick={() => setWithdrawalsShown(withdrawalsShown + 10)}
          >
            {t('showMore')}
          </button>
        )}
      </section>

      <section aria-labelledby="earnings" className="space-y-2">
        <h2 id="earnings" className="text-h3">
          {t('earnings')}
        </h2>
        {wallet.earnings.length === 0 && (
          <p className="text-body-sm text-text-muted">{t('noEarnings')}</p>
        )}
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {wallet.earnings.slice(0, earningsShown).map((e) => (
            <li key={e.lineId} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0 text-body-sm">
                <p className="font-semibold">
                  {e.orderNumber ? <span className="ltr-iso">{e.orderNumber}</span> : t('earning')}
                </p>
                <p className="text-caption text-text-muted">
                  {formatCairoDateTime(e.at, locale)}
                  {e.darkStore && <> · {localized(e.darkStore, locale)}</>}
                </p>
                <p
                  className={`text-caption ${e.available ? 'text-status-delivered' : 'text-status-in-progress'}`}
                >
                  {e.available
                    ? t('availableNow')
                    : t('availableOn', { day: isoToDayFirst(e.availableOn) })}
                </p>
              </div>
              <span className="tabular ltr-iso shrink-0 font-bold">
                {formatEgp(e.amountPiastres)}
              </span>
            </li>
          ))}
        </ul>
        {wallet.earnings.length > earningsShown && (
          <button
            type="button"
            className="btn-secondary h-10 w-full"
            onClick={() => setEarningsShown(earningsShown + 30)}
          >
            {t('showMore')}
          </button>
        )}
      </section>
    </div>
  );
}

type Method = WithdrawalDetails['method'];

function WithdrawForm({
  wallet,
  onDone,
  onCancel,
}: {
  wallet: RiderWalletView;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('riderPay');
  const locale = useLocale();
  const last = wallet.lastDetails;
  const [amount, setAmount] = useState(
    formatEgp(wallet.totals.availablePiastres).replace(/,/g, ''),
  );
  const [method, setMethod] = useState<Method>(last?.method ?? 'store_cash');
  const [handle, setHandle] = useState(last?.method === 'instapay' ? last.handle : '');
  const [provider, setProvider] = useState<(typeof MOBILE_WALLETS)[number]>(
    last?.method === 'mobile_wallet' ? last.provider : 'vodafone_cash',
  );
  const [phone, setPhone] = useState(last?.method === 'mobile_wallet' ? last.phone : '');
  const [bankName, setBankName] = useState(last?.method === 'bank' ? last.bankName : '');
  const [iban, setIban] = useState(last?.method === 'bank' ? last.iban : '');
  const [holder, setHolder] = useState(last?.method === 'bank' ? last.holder : '');
  const [key] = useState(newActionKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const piastres = parseEgp(amount);
  const problem = withdrawalProblem(piastres, wallet);
  const preview = withdrawalPreview(piastres ?? 0, wallet.owed);

  function details(): WithdrawalDetails {
    switch (method) {
      case 'store_cash':
        return { method };
      case 'instapay':
        return { method, handle };
      case 'mobile_wallet':
        return { method, provider, phone };
      case 'bank':
        return { method, bankName, iban, holder };
    }
  }

  async function submit() {
    if (problem || piastres === null) return setError(problem ?? 'invalid_amount');
    // A wrong IBAN, mobile or InstaPay address is named, not answered with a generic error.
    const detailsProblem = withdrawalDetailsProblem(details());
    if (detailsProblem) return setError(detailsProblem);
    setBusy(true);
    setError(null);
    const r = await apiSend('POST', '/rider/withdrawals', {
      amountPiastres: piastres,
      details: details(),
      idempotencyKey: key,
    });
    setBusy(false);
    if (!r.ok) return setError(withdrawalError(r.error, r.details));
    onDone(t('requested'));
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="block text-body-sm font-semibold">
        {t('amountLabel')}
        <div className="mt-1 flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className={field}
          />
          <button
            type="button"
            className="btn-secondary h-11 shrink-0 px-3"
            onClick={() => setAmount(formatEgp(wallet.totals.availablePiastres).replace(/,/g, ''))}
          >
            {t('all')}
          </button>
        </div>
      </label>
      <p className="text-caption text-text-muted">
        {t('limits', {
          max: formatEgp(wallet.totals.availablePiastres),
          min: formatEgp(wallet.rules.minPiastres),
        })}
      </p>

      <fieldset>
        <legend className="text-body-sm font-semibold">{t('methodLabel')}</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(['store_cash', 'instapay', 'mobile_wallet', 'bank'] as const).map((m) => (
            <label
              key={m}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
                method === m ? 'border-primary bg-selected-bg font-bold' : 'border-line'
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
              />
              {t(`methods.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {method === 'store_cash' && (
        <p className="text-caption text-text-muted">
          {t('storeCashHint', { store: localized(wallet.rider.darkStore, locale) })}
        </p>
      )}
      {method === 'instapay' && (
        <label className="block text-body-sm font-semibold">
          {t('instapayLabel')}
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            dir="ltr"
            placeholder="name@instapay"
            className={`${field} mt-1`}
          />
        </label>
      )}
      {method === 'mobile_wallet' && (
        <>
          <label className="block text-body-sm font-semibold">
            {t('walletLabel')}
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className={`${field} mt-1`}
            >
              {MOBILE_WALLETS.map((p) => (
                <option key={p} value={p}>
                  {t(`wallets.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-body-sm font-semibold">
            {t('phoneLabel')}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              dir="ltr"
              placeholder="01xxxxxxxxx"
              className={`${field} mt-1`}
            />
          </label>
        </>
      )}
      {method === 'bank' && (
        <>
          <label className="block text-body-sm font-semibold">
            {t('bankLabel')}
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className={`${field} mt-1`}
            />
          </label>
          <label className="block text-body-sm font-semibold">
            {t('ibanLabel')}
            <input
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              dir="ltr"
              placeholder="EG…"
              className={`${field} mt-1`}
            />
          </label>
          <label className="block text-body-sm font-semibold">
            {t('holderLabel')}
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              className={`${field} mt-1`}
            />
          </label>
        </>
      )}

      <dl className="space-y-1 rounded-md bg-bg p-3 text-body-sm">
        <div className="flex justify-between gap-3">
          <dt>{t('fromWallet')}</dt>
          <dd className="tabular ltr-iso">{formatEgp(preview.fromWalletPiastres)}</dd>
        </div>
        {preview.deductedPiastres > 0 && (
          <div className="flex justify-between gap-3 text-status-needs-action">
            <dt>{t('deductedLine')}</dt>
            <dd className="tabular ltr-iso">− {formatEgp(preview.deductedPiastres)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 font-bold">
          <dt>{t('youReceive')}</dt>
          <dd className="tabular ltr-iso">{formatEgp(preview.receivePiastres)}</dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {t(`errors.${KNOWN_ERRORS.includes(error) ? error : 'generic'}`)}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary h-12 flex-1">
          {t('send')}
        </button>
        <button type="button" className="btn-secondary h-12 px-4" onClick={onCancel}>
          {t('back')}
        </button>
      </div>
    </form>
  );
}
