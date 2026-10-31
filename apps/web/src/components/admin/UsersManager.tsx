'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';

type Role = 'admin' | 'merchant' | 'store_staff' | 'rider' | 'finance';
const ROLES: Role[] = ['admin', 'finance', 'store_staff', 'rider', 'merchant'];

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  darkStore: { id: string; code: string; nameEn: string; nameAr: string } | null;
  merchant: { id: string; name: string } | null;
  badgeCode: string | null;
  slackUserId: string | null;
}
type StoreRef = { id: string; nameEn: string; nameAr: string };
type MerchantRef = { id: string; name: string };

const KNOWN = [
  'email_taken',
  'phone_taken',
  'badge_taken',
  'slack_id_taken',
  'dark_store_required',
  'badge_required',
  'merchant_required',
  'cannot_deactivate_self',
  'rider_has_open_deliveries',
  'validation_failed',
];
const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function useErrors() {
  const t = useTranslations('admin.users');
  return (code: string) => t(`errors.${KNOWN.includes(code) ? code : 'generic'}`);
}

/** Store, merchant and badge fields, shown only for the roles that need them. */
function LinkFields({
  role,
  stores,
  merchants,
  initial,
}: {
  role: Role;
  stores: StoreRef[];
  merchants: MerchantRef[];
  initial?: AdminUser;
}) {
  const t = useTranslations('admin.users');
  const locale = useLocale();
  return (
    <>
      {(role === 'store_staff' || role === 'rider') && (
        <label className="block text-caption">
          {t('store')}
          <select
            name="darkStoreId"
            required
            defaultValue={initial?.darkStore?.id ?? ''}
            className={field}
          >
            <option value="" disabled />
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
      )}
      {role === 'rider' && (
        <label className="block text-caption">
          {t('badge')}
          <input
            name="badgeCode"
            required
            defaultValue={initial?.badgeCode ?? ''}
            pattern="[A-Za-z0-9\-]{3,20}"
            dir="ltr"
            placeholder="RDR-0003"
            className={field}
          />
        </label>
      )}
      {role === 'merchant' && (
        <label className="block text-caption">
          {t('merchant')}
          <select
            name="merchantId"
            required
            defaultValue={initial?.merchant?.id ?? ''}
            className={field}
          >
            <option value="" disabled />
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function links(form: FormData) {
  const get = (k: string) => (form.has(k) ? String(form.get(k)) : undefined);
  return {
    darkStoreId: get('darkStoreId'),
    merchantId: get('merchantId'),
    badgeCode: get('badgeCode'),
  };
}

export function UsersManager({
  users,
  stores,
  merchants,
  meId,
}: {
  users: AdminUser[];
  stores: StoreRef[];
  merchants: MerchantRef[];
  meId: string | null;
}) {
  const t = useTranslations('admin.users');
  const roles = useTranslations('roles');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrors();
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Role>('store_staff');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', '/admin/users', {
      email: form.get('email'),
      name: form.get('name'),
      phone: (form.get('phone') as string) || null,
      role,
      password: form.get('password'),
      ...links(form),
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setCreating(false);
    setNotice(t('created'));
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {notice && (
        <p
          role="status"
          className="rounded-md border border-line bg-surface-raised px-3 py-2 text-body-sm"
        >
          {notice}
        </p>
      )}
      {creating ? (
        <form
          onSubmit={create}
          className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <label className="block text-caption">
            {t('role')}
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={field}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roles(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption">
            {t('name')}
            <input name="name" required minLength={2} maxLength={120} className={field} />
          </label>
          <label className="block text-caption">
            {t('email')}
            <input
              name="email"
              type="email"
              required
              dir="ltr"
              autoComplete="off"
              className={field}
            />
          </label>
          <label className="block text-caption">
            {t('phone')}
            <input name="phone" type="tel" dir="ltr" placeholder="01xxxxxxxxx" className={field} />
          </label>
          <LinkFields role={role} stores={stores} merchants={merchants} />
          <label className="block text-caption">
            {t('password')}
            <input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              dir="ltr"
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
              {t('create')}
            </button>
            <button type="button" className={secondary} onClick={() => setCreating(false)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={primary} onClick={() => setCreating(true)}>
          {t('new')}
        </button>
      )}

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-sm">
        {users.map((u) => (
          <li key={u.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-body font-bold">
                  {u.name}
                  {u.id === meId && (
                    <span className="ms-2 text-caption text-text-muted">({t('you')})</span>
                  )}
                </p>
                <p className="ltr-iso text-caption text-text-muted">
                  {u.email}
                  {u.phone && ` · ${u.phone}`}
                </p>
                <p className="text-caption">
                  {roles(u.role)}
                  {u.darkStore && <> · {localized(u.darkStore, locale)}</>}
                  {u.merchant && <> · {u.merchant.name}</>}
                  {u.badgeCode && (
                    <>
                      {' '}
                      · <span className="ltr-iso">{u.badgeCode}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-pill border px-2.5 py-0.5 text-caption ${u.isActive ? 'border-line' : 'border-danger text-danger'}`}
                >
                  {u.isActive ? t('active') : t('inactive')}
                </span>
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setEditing(editing === u.id ? null : u.id)}
                >
                  {t('edit')}
                </button>
              </div>
            </div>
            {editing === u.id && (
              <UserEditor
                user={u}
                stores={stores}
                merchants={merchants}
                isMe={u.id === meId}
                onDone={(text) => {
                  setEditing(null);
                  setNotice(text);
                  router.refresh();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserEditor({
  user,
  stores,
  merchants,
  isMe,
  onDone,
}: {
  user: AdminUser;
  stores: StoreRef[];
  merchants: MerchantRef[];
  isMe: boolean;
  onDone(notice: string): void;
}) {
  const t = useTranslations('admin.users');
  const errorText = useErrors();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  async function run(method: 'PATCH' | 'POST', path: string, body: unknown, notice: string) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onDone(notice);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      'PATCH',
      `/admin/users/${user.id}`,
      {
        name: form.get('name'),
        phone: (form.get('phone') as string) || null,
        slackUserId: String(form.get('slackUserId') ?? '').trim() || null,
        ...links(form),
      },
      t('saved'),
    );
  }

  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      <form onSubmit={save} className="space-y-3">
        <label className="block text-caption">
          {t('name')}
          <input name="name" required minLength={2} defaultValue={user.name} className={field} />
        </label>
        {user.role !== 'merchant' && (
          <label className="block text-caption">
            {t('slackId')}
            <input
              name="slackUserId"
              defaultValue={user.slackUserId ?? ''}
              pattern="[UWuw][A-Za-z0-9]{6,20}"
              dir="ltr"
              placeholder="U0123ABCD"
              className={field}
            />
            <span className="mt-1 block text-text-muted">{t('slackIdHint')}</span>
          </label>
        )}
        <label className="block text-caption">
          {t('phone')}
          <input
            name="phone"
            type="tel"
            dir="ltr"
            defaultValue={user.phone ?? ''}
            className={field}
          />
        </label>
        <LinkFields role={user.role} stores={stores} merchants={merchants} initial={user} />
        <button type="submit" disabled={busy} className={primary}>
          {t('save')}
        </button>
      </form>
      <div className="space-y-3">
        <label className="block text-caption">
          {t('resetPassword')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={10}
            autoComplete="new-password"
            dir="ltr"
            className={field}
          />
        </label>
        <button
          type="button"
          disabled={busy || password.length < 10}
          className={secondary}
          onClick={() =>
            void run('POST', `/admin/users/${user.id}/password`, { password }, t('passwordSet'))
          }
        >
          {t('setPassword')}
        </button>
        {!isMe && (
          <div>
            <button
              type="button"
              disabled={busy}
              className={`${secondary} ${user.isActive ? 'text-danger' : ''}`}
              onClick={() =>
                void run(
                  'PATCH',
                  `/admin/users/${user.id}`,
                  { isActive: !user.isActive },
                  t('saved'),
                )
              }
            >
              {user.isActive ? t('disable') : t('enable')}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
