'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';

export interface AdminMerchant {
  id: string;
  name: string;
  isActive: boolean;
  approval: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  createdAt: string;
  contactEmail: string | null;
  contactPhone: string | null;
  shopifyShopDomain: string | null;
  skuCount: number;
  shipmentCount: number;
  accountManager: { id: string; name: string } | null;
}

/** What the merchant's actions need to know. */
export type MerchantBasics = Pick<
  AdminMerchant,
  'id' | 'name' | 'contactEmail' | 'contactPhone' | 'isActive' | 'approval' | 'accountManager'
>;

export interface AccountManagerOption {
  id: string;
  name: string;
  email: string;
}

/** Merchants manage picks the merchant's account manager (docs/HR.md 5). */
function AccountManagerPicker({
  merchant,
  managers,
  canAssign,
}: {
  merchant: MerchantBasics;
  managers: AccountManagerOption[];
  canAssign: boolean;
}) {
  const t = useTranslations('admin.merchants');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canAssign)
    return (
      <p className="mt-1 text-body-sm">
        <span className="text-text-muted">{t('accountManager')}:</span>{' '}
        {merchant.accountManager?.name ?? t('noAccountManager')}
      </p>
    );
  async function change(userId: string) {
    setBusy(true);
    setError(null);
    const result = await apiSend('PUT', `/admin/merchants/${merchant.id}/account-manager`, {
      userId: userId || null,
    });
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    router.refresh();
  }
  const current = merchant.accountManager;
  return (
    <label className="mt-2 block max-w-xs text-caption">
      {t('accountManager')}
      <select
        value={current?.id ?? ''}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        className={field}
      >
        <option value="">{t('noAccountManager')}</option>
        {current && !managers.some((m) => m.id === current.id) && (
          <option value={current.id}>{current.name}</option>
        )}
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="mt-1 block text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function MerchantForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial?: MerchantBasics;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): void;
  onCancel(): void;
  busy: boolean;
  error: string | null;
}) {
  const t = useTranslations('admin.merchants');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: form.get('name'),
      contactEmail: (form.get('contactEmail') as string) || null,
      contactPhone: (form.get('contactPhone') as string) || null,
    });
  }
  return (
    <form
      onSubmit={submit}
      className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <label className="block text-caption">
        {t('name')}
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={initial?.name}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('contactEmail')}
        <input
          name="contactEmail"
          type="email"
          dir="ltr"
          defaultValue={initial?.contactEmail ?? ''}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('contactPhone')}
        <input
          name="contactPhone"
          type="tel"
          dir="ltr"
          defaultValue={initial?.contactPhone ?? ''}
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>
          {submitLabel}
        </button>
        <button type="button" className={secondary} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

/** The merchants list's button: a new merchant (approved at once, as before). */
export function NewMerchantButton() {
  const t = useTranslations('admin.merchants');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/admin/merchants', body);
    setBusy(false);
    if (!result.ok)
      return setError(
        t(`errors.${result.error === 'validation_failed' ? 'validation_failed' : 'generic'}`),
      );
    setOpen(false);
    router.push(`/admin/merchants/${result.data.id}`);
  }
  return open ? (
    <div className="w-full">
      <MerchantForm
        submitLabel={t('create')}
        busy={busy}
        error={error}
        onSubmit={(body) => void create(body)}
        onCancel={() => setOpen(false)}
      />
    </div>
  ) : (
    <button type="button" className={primary} onClick={() => setOpen(true)}>
      {t('new')}
    </button>
  );
}

/**
 * The merchant page's actions: approve or reject a sign up (merchants manage), edit the
 * contact details, pause or resume (merchants use), and pick the account manager.
 */
export function MerchantActions({
  merchant,
  managers,
  canAssign,
  canEdit,
  canDecide,
}: {
  merchant: MerchantBasics;
  managers: AccountManagerOption[];
  canAssign: boolean;
  canEdit: boolean;
  canDecide: boolean;
}) {
  const t = useTranslations('admin.merchants');
  const ts = useTranslations('admin.merchants.signups');
  const router = useRouter();
  const [mode, setMode] = useState<'edit' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: 'POST' | 'PATCH', path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok)
      return setError(
        t(`errors.${result.error === 'validation_failed' ? 'validation_failed' : 'generic'}`),
      );
    setMode(null);
    setReason('');
    router.refresh();
  }

  const pending = merchant.approval === 'pending';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pending && canDecide && (
          <>
            <button
              type="button"
              disabled={busy}
              className={primary}
              onClick={() => void send('POST', `/admin/merchants/${merchant.id}/approve`, {})}
            >
              {ts('approve')}
            </button>
            <button
              type="button"
              className={`${secondary} text-danger`}
              onClick={() => setMode(mode === 'reject' ? null : 'reject')}
            >
              {ts('reject')}
            </button>
          </>
        )}
        {canEdit && (
          <button
            type="button"
            className={secondary}
            aria-expanded={mode === 'edit'}
            onClick={() => setMode(mode === 'edit' ? null : 'edit')}
          >
            {t('edit')}
          </button>
        )}
        {canEdit && merchant.approval === 'approved' && (
          <button
            type="button"
            disabled={busy}
            className={secondary}
            onClick={() =>
              void send('PATCH', `/admin/merchants/${merchant.id}`, {
                isActive: !merchant.isActive,
              })
            }
          >
            {merchant.isActive ? t('pause') : t('resume')}
          </button>
        )}
      </div>
      {mode === 'reject' && (
        <div className="flex flex-wrap gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={ts('reason')}
            aria-label={ts('reason')}
            maxLength={300}
            className="h-10 min-w-56 flex-1 rounded-md border border-line bg-surface px-3 text-body-sm"
          />
          <button
            type="button"
            disabled={busy || reason.trim().length < 2}
            onClick={() => void send('POST', `/admin/merchants/${merchant.id}/reject`, { reason })}
            className={`${secondary} border-danger text-danger`}
          >
            {ts('confirmReject')}
          </button>
        </div>
      )}
      {mode === 'edit' && (
        <MerchantForm
          initial={merchant}
          submitLabel={t('save')}
          busy={busy}
          error={error}
          onSubmit={(body) => void send('PATCH', `/admin/merchants/${merchant.id}`, body)}
          onCancel={() => setMode(null)}
        />
      )}
      {error && mode !== 'edit' && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <AccountManagerPicker merchant={merchant} managers={managers} canAssign={canAssign} />
    </div>
  );
}
