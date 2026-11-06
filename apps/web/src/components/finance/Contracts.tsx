'use client';

import { cairoDay, type ContractTier } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ReceiptField } from './ReceiptField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// A merchant's contract: the read view (admin, Accounting and the merchant), the editor
// (merchants manage) and the security deposit form (Accounting).

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';

export interface ContractView {
  merchant: { id: string; name: string };
  contract: {
    startDate: string;
    endDate: string | null;
    noticeDays: number;
    noticeBy: string | null;
    minimumMonthlyFeePiastres: number | null;
    securityDepositPiastres: number | null;
    creditLimitPiastres: number | null;
    note: string | null;
    tiers: ContractTier[];
    inForce: boolean;
  } | null;
  settings: { orderFixedPiastres: number; orderPercentBp: number; codPercentBp: number };
  deliveredThisMonth: number;
  nextOrderTier: ContractTier | null;
  depositHeldPiastres: number;
  owedPiastres: number;
  overCreditLimit: boolean;
}

/** Basis points as a percentage, without a float: 250 is "2.50". */
export const bpText = (bp: number) => formatEgp(bp);
const money = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-text-muted">{hint}</span>}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-t-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** The contract as it stands, and (for merchants manage) the editor. */
export function ContractPanel({
  view,
  canEdit,
  internal,
}: {
  view: ContractView;
  canEdit: boolean;
  /** Shows the internal note and the balance (not for the merchant) */
  internal: boolean;
}) {
  const t = useTranslations('contracts');
  const [editing, setEditing] = useState(false);
  const c = view.contract;
  const tierText = (tier: ContractTier) =>
    [
      tier.fixedFeePiastres !== null ? `${formatEgp(tier.fixedFeePiastres)} EGP` : null,
      tier.percentBp !== null ? `${bpText(tier.percentBp)}%` : null,
    ]
      .filter(Boolean)
      .join(' + ');
  if (editing) return <ContractEditor view={view} onDone={() => setEditing(false)} />;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3">{t('title')}</h2>
        {c && (
          <span
            className={`rounded-pill border px-2.5 py-0.5 text-caption ${c.inForce ? 'border-line' : 'border-danger text-danger'}`}
          >
            {c.inForce ? t('inForce') : t('notInForce')}
          </span>
        )}
      </div>
      <p className="text-body-sm text-text-muted">
        {t('settingsFees', {
          fixed: formatEgp(view.settings.orderFixedPiastres),
          percent: bpText(view.settings.orderPercentBp),
          cod: bpText(view.settings.codPercentBp),
        })}
      </p>
      {!c ? (
        <p className="text-body-sm">{t('none')}</p>
      ) : (
        <dl className="text-body-sm">
          <Row label={t('start')}>
            <span className="ltr-iso">{isoToDayFirst(c.startDate)}</span>
          </Row>
          <Row label={t('end')}>
            {c.endDate ? (
              <span className="ltr-iso">{isoToDayFirst(c.endDate)}</span>
            ) : (
              t('openEnded')
            )}
          </Row>
          <Row label={t('notice')}>
            <span className="ltr-iso">{c.noticeDays}</span>
            {c.noticeBy && (
              <span className="block text-caption text-text-muted">
                {t('noticeBy', { day: isoToDayFirst(c.noticeBy) })}
              </span>
            )}
          </Row>
          <Row label={t('minimum')}>
            {c.minimumMonthlyFeePiastres !== null ? (
              <Amount piastres={c.minimumMonthlyFeePiastres} />
            ) : (
              t('empty')
            )}
          </Row>
          <Row label={t('deposit')}>
            {c.securityDepositPiastres !== null ? (
              <Amount piastres={c.securityDepositPiastres} />
            ) : (
              t('empty')
            )}
          </Row>
          <Row label={t('creditLimit')}>
            {c.creditLimitPiastres !== null ? (
              <Amount piastres={c.creditLimitPiastres} />
            ) : (
              t('empty')
            )}
          </Row>
          <Row label={t('tiers')}>
            {c.tiers.length ? (
              <ul className="space-y-1">
                {c.tiers.map((tier) => (
                  <li key={tier.fromOrder}>
                    <span className="text-text-muted">
                      {t('fromOrder')} <span className="ltr-iso">{tier.fromOrder}</span>:
                    </span>{' '}
                    <span className="ltr-iso">{tierText(tier)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              t('empty')
            )}
          </Row>
          {internal && c.note && <Row label={t('note')}>{c.note}</Row>}
        </dl>
      )}
      <ul className="space-y-1 text-body-sm">
        <li>{t('monthSoFar', { count: view.deliveredThisMonth })}</li>
        {view.nextOrderTier && <li>{t('nextBand', { from: view.nextOrderTier.fromOrder })}</li>}
        <li>{t('held', { amount: formatEgp(view.depositHeldPiastres) })}</li>
        {internal && <li>{t('owed', { amount: formatEgp(view.owedPiastres) })}</li>}
        {view.overCreditLimit && <li className="font-bold text-danger">{t('overLimit')}</li>}
      </ul>
      {canEdit ? (
        <button type="button" className={secondary} onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
      ) : (
        !internal && <p className="text-caption text-text-muted">{t('readOnly')}</p>
      )}
    </section>
  );
}

interface TierForm {
  fromOrder: string;
  fixed: string;
  percent: string;
}

function ContractEditor({ view, onDone }: { view: ContractView; onDone: () => void }) {
  const t = useTranslations('contracts');
  const router = useRouter();
  const c = view.contract;
  const initial = {
    startDate: c?.startDate ?? cairoDay(new Date()),
    endDate: c?.endDate ?? '',
    noticeDays: String(c?.noticeDays ?? 30),
    minimum: money(c?.minimumMonthlyFeePiastres ?? null),
    deposit: money(c?.securityDepositPiastres ?? null),
    creditLimit: money(c?.creditLimitPiastres ?? null),
    note: c?.note ?? '',
    tiers: (c?.tiers ?? []).map((tier) => ({
      fromOrder: String(tier.fromOrder),
      fixed: money(tier.fixedFeePiastres),
      percent: tier.percentBp === null ? '' : bpText(tier.percentBp),
    })) as TierForm[],
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k: keyof Omit<typeof form, 'tiers'>) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setTier = (i: number, k: keyof TierForm, v: string) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const optional = (text: string) => (text.trim() ? parseEgp(text) : null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      startDate: form.startDate,
      endDate: form.endDate || null,
      noticeDays: Number(form.noticeDays),
      minimumMonthlyFeePiastres: optional(form.minimum),
      securityDepositPiastres: optional(form.deposit),
      creditLimitPiastres: optional(form.creditLimit),
      note: form.note.trim() || null,
      tiers: form.tiers.map((tier) => ({
        fromOrder: Number(tier.fromOrder),
        fixedFeePiastres: optional(tier.fixed),
        percentBp: optional(tier.percent),
      })),
    };
    const result = await apiSend('PUT', `/admin/merchants/${view.merchant.id}/contract`, body);
    setBusy(false);
    if (!result.ok)
      return setError(
        t(`errors.${result.error === 'validation_failed' ? 'validation_failed' : 'generic'}`),
      );
    onDone();
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => void save(e)}
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
    >
      <h2 className="text-h3 sm:col-span-2">{t('edit')}</h2>
      <Field label={t('start')}>
        <DateInput
          value={form.startDate}
          onChange={(e) => set('startDate')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('end')}>
        <DateInput
          value={form.endDate}
          onChange={(e) => set('endDate')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('notice')}>
        <input
          type="number"
          min={0}
          max={3650}
          required
          value={form.noticeDays}
          onChange={(e) => set('noticeDays')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('minimum')} hint={t('minimumHint')}>
        <input
          inputMode="decimal"
          dir="ltr"
          value={form.minimum}
          onChange={(e) => set('minimum')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('deposit')}>
        <input
          inputMode="decimal"
          dir="ltr"
          value={form.deposit}
          onChange={(e) => set('deposit')(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('creditLimit')} hint={t('creditLimitHint')}>
        <input
          inputMode="decimal"
          dir="ltr"
          value={form.creditLimit}
          onChange={(e) => set('creditLimit')(e.target.value)}
          className={field}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('note')}>
          <input
            maxLength={500}
            value={form.note}
            onChange={(e) => set('note')(e.target.value)}
            className={field}
          />
        </Field>
      </div>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-body-sm font-bold">{t('tiers')}</legend>
        <p className="text-caption text-text-muted">{t('tiersHint')}</p>
        {form.tiers.map((tier, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
            <Field label={t('fromOrder')}>
              <input
                type="number"
                min={1}
                required
                value={tier.fromOrder}
                onChange={(e) => setTier(i, 'fromOrder', e.target.value)}
                className={field}
              />
            </Field>
            <Field label={t('fixed')}>
              <input
                inputMode="decimal"
                dir="ltr"
                value={tier.fixed}
                onChange={(e) => setTier(i, 'fixed', e.target.value)}
                className={field}
              />
            </Field>
            <Field label={t('percent')}>
              <input
                inputMode="decimal"
                dir="ltr"
                value={tier.percent}
                onChange={(e) => setTier(i, 'percent', e.target.value)}
                className={field}
              />
            </Field>
            <button
              type="button"
              className={secondary}
              onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))}
            >
              {t('remove')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={secondary}
          onClick={() =>
            setForm((f) => ({
              ...f,
              tiers: [
                ...f.tiers,
                {
                  fromOrder: String(
                    f.tiers.length ? Number(f.tiers[f.tiers.length - 1]!.fromOrder) + 100 : 1,
                  ),
                  fixed: '',
                  percent: '',
                },
              ],
            }))
          }
        >
          {t('addTier')}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-body-sm text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <FormFooter dirty={dirty} busy={busy} saveLabel={t('save')} onCancel={onDone} />
      </div>
    </form>
  );
}

/** Accounting receives or pays back a merchant's security deposit (second person rule). */
export function DepositForm({ merchantId }: { merchantId: string }) {
  const t = useTranslations('finance.contracts');
  const tf = useTranslations('finance');
  const { busy, message, send } = useFinanceAction();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [via, setVia] = useState<'bank' | 'wallet'>('bank');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className={secondary} onClick={() => setOpen(true)}>
        {t('depositAction')}
      </button>
    );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const piastres = parseEgp(amount);
    if (!piastres) return;
    const done = await send('POST', `/finance/merchants/${merchantId}/deposit`, {
      direction,
      via,
      amountPiastres: piastres,
      reference,
      ...(photoId ? { receiptPhotoId: photoId } : {}),
      idempotencyKey: newActionKey(),
    });
    if (done) {
      setAmount('');
      setReference('');
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-2 sm:grid-cols-2">
      <Field label={t('direction')}>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
          className={field}
        >
          <option value="in">{t('in')}</option>
          <option value="out">{t('out')}</option>
        </select>
      </Field>
      <Field label={t('via')}>
        <select
          value={via}
          onChange={(e) => setVia(e.target.value as 'bank' | 'wallet')}
          className={field}
        >
          <option value="bank">{t('viaBank')}</option>
          <option value="wallet">{t('viaWallet')}</option>
        </select>
      </Field>
      <Field label={tf('amount')}>
        <input
          required
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t('reference')}>
        <input
          required
          minLength={2}
          maxLength={100}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={field}
        />
      </Field>
      <ReceiptField onChange={setPhotoId} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className={primary}>
          {t('submit')}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          {tf('cancel')}
        </button>
        <ActionMessage message={message} />
      </div>
    </form>
  );
}
