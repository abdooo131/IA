'use client';

import { addDays, cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type {
  CompanyProfile,
  EtaReadiness,
  EtaState,
  InvoiceDetail,
  InvoiceRow,
  MerchantTax,
} from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { BankDetailsForm } from './BankDetailsForm';
import { ActionMessage, useFinanceAction } from './useFinanceAction';
import { StatusPill } from '@/components/StatusPill';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export function EtaStatusText({ status }: { status: EtaState }) {
  const t = useTranslations('finance.invoices');
  return <StatusPill status={status}>{t(`status.${status}`)}</StatusPill>;
}

/** The invoices list: what blocks the e-invoice flow, preparing a month, every document. */
export function InvoiceList({
  rows,
  readiness,
  base,
  hideTable = false,
}: {
  rows: InvoiceRow[];
  readiness: EtaReadiness | null;
  base: string;
  /** The page lists invoices in its own list view */
  hideTable?: boolean;
}) {
  const t = useTranslations('finance.invoices');
  const locale = useLocale();
  const prepare = useFinanceAction();
  const sync = useFinanceAction();
  const lastMonth = addDays(`${cairoDay(new Date()).slice(0, 8)}01`, -1).slice(0, 7);
  const [month, setMonth] = useState(lastMonth);
  return (
    <div className="mt-4 space-y-6">
      {readiness && (
        <section
          className={`rounded-lg border p-4 ${readiness.ready && readiness.connected ? 'border-line bg-surface' : 'border-danger bg-surface'}`}
        >
          <h2 className="text-h3">{t('etaTitle')}</h2>
          {readiness.ready && readiness.connected ? (
            <p className="text-body-sm">{t('etaReady')}</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-body-sm">
              {!readiness.connected && <li>{t('missing.connection')}</li>}
              {readiness.missing.map((m) => (
                <li key={m}>{t(`missing.${m}`)}</li>
              ))}
              {readiness.missingCodes.length > 0 && (
                <li>
                  {t('missing.item_codes', {
                    kinds: readiness.missingCodes
                      .map(
                        (k) =>
                          (locale === 'ar'
                            ? readiness.feeKinds[k]?.ar
                            : readiness.feeKinds[k]?.en) ?? k,
                      )
                      .join('، '),
                  })}
                </li>
              )}
            </ul>
          )}
          <p className="mt-2 text-caption text-text-muted">
            {(['not_sent', 'signed', 'submitted', 'valid', 'invalid', 'rejected'] as const)
              .map((s) => `${t(`status.${s}`)}: ${readiness.counts[s] ?? 0}`)
              .join(' · ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/finance/company" className={`${secondary} inline-flex items-center`}>
              {t('openCompany')}
            </a>
            {readiness.connected && (
              <button
                type="button"
                className={secondary}
                disabled={sync.busy}
                onClick={() => void sync.send('POST', '/finance/eta/sync', {}, () => t('synced'))}
              >
                {t('syncNow')}
              </button>
            )}
          </div>
          <ActionMessage message={sync.message} />
        </section>
      )}

      {readiness && (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <label className="text-caption">
            {t('month')}
            <input
              type="month"
              value={month}
              max={lastMonth}
              onChange={(e) => setMonth(e.target.value)}
              dir="ltr"
              className={`${field} mt-1 block w-44`}
            />
          </label>
          <button
            type="button"
            className={primary}
            disabled={prepare.busy || !month}
            onClick={() =>
              void prepare.send<{ created: number }>(
                'POST',
                '/finance/invoices/prepare',
                { month },
                (d) => t('prepared', { count: d.created, month }),
              )
            }
          >
            {t('prepare')}
          </button>
          <p className="w-full text-caption text-text-muted">{t('prepareHint')}</p>
          <ActionMessage message={prepare.message} />
        </section>
      )}

      {hideTable ? null : rows.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('none')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('number')}</th>
                {readiness && <th className={th}>{t('merchant')}</th>}
                <th className={th}>{t('date')}</th>
                <th className={`${th} text-end`}>{t('total')}</th>
                <th className={th}>{t('etaState')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className={td}>
                    <a href={`${base}/${r.id}`} className="ltr-iso font-bold underline">
                      {r.label}
                    </a>
                    <span className="block text-caption text-text-muted">
                      {r.type === 'invoice'
                        ? t('forMonth', { month: r.periodMonth ?? '' })
                        : t('against', { number: r.original ?? '' })}
                    </span>
                  </td>
                  {readiness && <td className={td}>{r.merchant.legalName ?? r.merchant.name}</td>}
                  <td className={td}>{formatCairoDateTime(r.issuedAt, locale)}</td>
                  <td className={`${td} text-end`}>
                    <Amount
                      piastres={r.type === 'credit_note' ? -r.totalPiastres : r.totalPiastres}
                      strong
                    />
                  </td>
                  <td className={td}>
                    <EtaStatusText status={r.etaStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Finance actions on one invoice: credit note, send again after a rejection. */
export function InvoiceActions({ invoice }: { invoice: InvoiceDetail }) {
  const t = useTranslations('finance.invoices');
  const note = useFinanceAction();
  const resend = useFinanceAction();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const value = parseEgp(amount);
  return (
    <div className="mt-6 max-w-3xl space-y-4 print:hidden">
      <p className="text-body-sm">
        {t('etaState')}: <EtaStatusText status={invoice.etaStatus} />
      </p>
      {invoice.etaError != null && (
        <pre className="overflow-x-auto rounded-md bg-surface-raised p-3 text-caption">
          {JSON.stringify(invoice.etaError, null, 2).slice(0, 3000)}
        </pre>
      )}
      {(invoice.etaStatus === 'rejected' || invoice.etaStatus === 'invalid') && (
        <div>
          <p className="text-caption text-text-muted">{t('resendHint')}</p>
          <button
            type="button"
            className={secondary}
            disabled={resend.busy}
            onClick={() => void resend.send('POST', `/finance/invoices/${invoice.id}/resend`, {})}
          >
            {t('resend')}
          </button>
          <ActionMessage message={resend.message} />
        </div>
      )}
      {invoice.creditNotes.length > 0 && (
        <p className="text-body-sm">
          {t('creditNotes')}:{' '}
          {invoice.creditNotes.map((c) => (
            <a key={c.id} href={`/finance/invoices/${c.id}`} className="ltr-iso me-2 underline">
              {c.label}
            </a>
          ))}
        </p>
      )}
      {invoice.type === 'invoice' && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('newCreditNote')}</h2>
          <p className="text-caption text-text-muted">{t('creditNoteHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              placeholder={t('amountBeforeVat')}
              aria-label={t('amountBeforeVat')}
              className={field}
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reason')}
              aria-label={t('reason')}
              className={field}
            />
          </div>
          <button
            type="button"
            className={primary}
            disabled={note.busy || !value || reason.trim().length < 5}
            onClick={async () => {
              const ok = await note.send('POST', `/finance/invoices/${invoice.id}/credit-notes`, {
                amountPiastres: value,
                reason,
                idempotencyKey: newActionKey(),
              });
              if (ok) {
                setAmount('');
                setReason('');
              }
            }}
          >
            {t('issueCreditNote')}
          </button>
          <ActionMessage message={note.message} />
        </section>
      )}
    </div>
  );
}

const PROFILE_FIELDS = [
  'legalNameAr',
  'legalNameEn',
  'taxRegistrationNumber',
  'activityCode',
  'branchId',
  'governorate',
  'regionCity',
  'street',
  'buildingNumber',
] as const;

/** Our tax details, the item codes per fee, the e-invoice switch and the signing key. */
export function CompanyTax({
  profile,
  feeKinds,
  merchants,
  isAdmin,
}: {
  profile: CompanyProfile;
  feeKinds: Record<string, { en: string; ar: string }>;
  merchants: MerchantTax[];
  isAdmin: boolean;
}) {
  const t = useTranslations('finance.invoices');
  const locale = useLocale();
  const save = useFinanceAction();
  const keyAction = useFinanceAction();
  const [p, setP] = useState(profile);
  const [newKey, setNewKey] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-8">
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('companyDetails')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFILE_FIELDS.map((k) => (
            <label key={k} className="block text-caption">
              {t(`fields.${k}`)}
              <input
                value={p[k]}
                onChange={(e) => setP({ ...p, [k]: e.target.value })}
                dir={k === 'legalNameAr' ? 'rtl' : 'auto'}
                className={`${field} mt-1`}
              />
            </label>
          ))}
        </div>
        <h3 className="text-body font-bold">{t('itemCodes')}</h3>
        <p className="text-caption text-text-muted">{t('itemCodesHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(feeKinds).map(([k, names]) => (
            <label key={k} className="block text-caption">
              {locale === 'ar' ? names.ar : names.en}
              <input
                value={p.itemCodes[k] ?? ''}
                onChange={(e) => setP({ ...p, itemCodes: { ...p.itemCodes, [k]: e.target.value } })}
                dir="ltr"
                placeholder="EG-123456789-..."
                className={`${field} mt-1`}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={p.etaEnabled}
            onChange={(e) => setP({ ...p, etaEnabled: e.target.checked })}
          />
          {t('etaOn')}
        </label>
        <button
          type="button"
          className={primary}
          disabled={save.busy}
          onClick={() =>
            void save.send('PUT', '/finance/company-profile', {
              ...Object.fromEntries(PROFILE_FIELDS.map((k) => [k, p[k]])),
              itemCodes: p.itemCodes,
              etaEnabled: p.etaEnabled,
            })
          }
        >
          {t('save')}
        </button>
        <ActionMessage message={save.message} />
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('signerTitle')}</h2>
        <p className="text-body-sm">{t('signerHint')}</p>
        <p className="text-caption text-text-muted">
          {profile.hasSignerKey
            ? t('signerKeySince', {
                date: profile.signerKeyCreatedAt
                  ? formatCairoDateTime(profile.signerKeyCreatedAt, locale)
                  : '',
              })
            : t('noSignerKey')}
        </p>
        {isAdmin && (
          <button
            type="button"
            className={secondary}
            disabled={keyAction.busy}
            onClick={async () => {
              const result = await keyAction.send<{ key: string }>(
                'POST',
                '/finance/company-profile/signer-key',
                {},
                () => t('keyCreated'),
              );
              if (result) setNewKey(result.key);
            }}
          >
            {t('newSignerKey')}
          </button>
        )}
        {newKey && (
          <p
            className="break-all rounded-md bg-surface-raised p-3 font-mono text-body-sm"
            dir="ltr"
          >
            {newKey}
          </p>
        )}
        <ActionMessage message={keyAction.message} />
      </section>

      <section className="space-y-2">
        <h2 className="text-h3">{t('merchantsTax')}</h2>
        <p className="text-caption text-text-muted">{t('merchantsTaxHint')}</p>
        {merchants.map((m) => (
          <MerchantTaxRow key={m.id} merchant={m} />
        ))}
      </section>
    </div>
  );
}

const MERCHANT_FIELDS = [
  'legalName',
  'taxRegistrationNumber',
  'taxGovernorate',
  'taxRegionCity',
  'taxStreet',
  'taxBuildingNumber',
] as const;

function MerchantTaxRow({ merchant }: { merchant: MerchantTax }) {
  const t = useTranslations('finance.invoices');
  const action = useFinanceAction();
  const [m, setM] = useState(merchant);
  const [open, setOpen] = useState(false);
  const complete = Boolean(
    m.taxRegistrationNumber &&
    m.taxGovernorate &&
    m.taxRegionCity &&
    m.taxStreet &&
    m.taxBuildingNumber,
  );
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-start"
      >
        <span className="font-bold">{m.name}</span>
        <span className={`text-caption ${complete ? 'text-status-delivered' : 'text-text-muted'}`}>
          {m.taxRegistrationNumber
            ? complete
              ? t('companyComplete')
              : t('addressMissing')
            : t('person')}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {MERCHANT_FIELDS.map((k) => (
              <label key={k} className="block text-caption">
                {t(`merchantFields.${k}`)}
                <input
                  value={m[k] ?? ''}
                  onChange={(e) => setM({ ...m, [k]: e.target.value })}
                  className={`${field} mt-1`}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className={secondary}
            disabled={action.busy}
            onClick={() =>
              void action.send(
                'PUT',
                `/finance/merchants/${m.id}/tax`,
                Object.fromEntries(MERCHANT_FIELDS.map((k) => [k, m[k] || null])),
              )
            }
          >
            {t('save')}
          </button>
          <ActionMessage message={action.message} />
          <h3 className="pt-2 text-body font-bold">{t('payoutBank')}</h3>
          <BankDetailsForm details={m} path={`/finance/merchants/${m.id}/bank`} />
        </div>
      )}
    </div>
  );
}
