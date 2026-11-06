'use client';

import { MERCHANT_RIGHTS, type MerchantRightName, type MerchantTeamRole } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { FormFooter } from '@/components/workflow/FormFooter';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  merchantRole: MerchantTeamRole;
  merchantRights: MerchantRightName[];
  createdAt: string;
}

const KNOWN = [
  'email_taken',
  'phone_taken',
  'cannot_remove_self',
  'last_owner',
  'owner_only',
  'user_not_found',
  'validation_failed',
];
const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function useErrors() {
  const t = useTranslations('merchant.team.errors');
  return (code: string) => t(KNOWN.includes(code) ? code : 'generic');
}

/** Owner or member, and for members the rights they have (owners have every right). */
function RoleAndRights({
  name,
  role,
  rights,
  onRole,
  onRights,
}: {
  name: string;
  role: MerchantTeamRole;
  rights: MerchantRightName[];
  onRole(role: MerchantTeamRole): void;
  onRights(rights: MerchantRightName[]): void;
}) {
  const t = useTranslations('merchant.team');
  return (
    <>
      <fieldset>
        <legend className="text-caption">{t('role')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(['member', 'owner'] as const).map((r) => (
            <label
              key={r}
              className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-body-sm"
            >
              <input
                type="radio"
                name={`${name}-role`}
                checked={role === r}
                onChange={() => onRole(r)}
                className="h-4 w-4"
              />
              {t(`roles.${r}`)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-caption text-text-muted">{t(`roleHints.${role}`)}</p>
      </fieldset>
      {role === 'member' && (
        <fieldset>
          <legend className="text-caption">{t('rights')}</legend>
          <ul className="mt-1 space-y-1">
            {MERCHANT_RIGHTS.map((right) => {
              const on = rights.includes(right);
              return (
                <li key={right}>
                  <label className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-body-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        onRights(on ? rights.filter((r) => r !== right) : [...rights, right])
                      }
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      <span className="font-semibold">{t(`rightNames.${right}`)}</span>
                      <span className="block text-caption text-text-muted">
                        {t(`rightHints.${right}`)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </>
  );
}

/**
 * The merchant's team, for owners: add people with their rights, change them, disable an
 * account and set a new password. An owner cannot remove themselves and one active owner
 * always stays.
 */
export function TeamManager({ team, meId }: { team: TeamMember[]; meId: string | null }) {
  const t = useTranslations('merchant.team');
  const router = useRouter();
  const errorText = useErrors();
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<MerchantTeamRole>('member');
  const [rights, setRights] = useState<MerchantRightName[]>(['orders']);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function closeCreate() {
    setCreating(false);
    setTouched(false);
    setError(null);
    setRole('member');
    setRights(['orders']);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', '/merchant/team', {
      name: form.get('name'),
      email: form.get('email'),
      phone: (form.get('phone') as string) || null,
      password: form.get('password'),
      merchantRole: role,
      merchantRights: role === 'member' ? rights : [],
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    closeCreate();
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
          onChange={() => setTouched(true)}
          className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <h2 className="text-h3">{t('new')}</h2>
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
          <RoleAndRights
            name="new"
            role={role}
            rights={rights}
            onRole={setRole}
            onRights={setRights}
          />
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
          <FormFooter dirty={touched} busy={busy} saveLabel={t('add')} onCancel={closeCreate} />
        </form>
      ) : (
        <button type="button" className={primary} onClick={() => setCreating(true)}>
          {t('new')}
        </button>
      )}

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-sm">
        {team.map((m) => (
          <li key={m.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-bold">
                  {m.name}
                  {m.id === meId && (
                    <span className="ms-2 text-caption text-text-muted">({t('you')})</span>
                  )}
                </p>
                <p className="ltr-iso break-all text-caption text-text-muted">
                  {m.email}
                  {m.phone && ` · ${m.phone}`}
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-caption">
                  <span className="rounded-pill bg-selected-bg px-2.5 py-0.5 font-bold text-link">
                    {t(`roles.${m.merchantRole}`)}
                  </span>
                  {m.merchantRole === 'member' &&
                    (m.merchantRights.length === 0 ? (
                      <span className="px-1 text-text-muted">{t('noRights')}</span>
                    ) : (
                      m.merchantRights.map((r) => (
                        <span key={r} className="rounded-pill border border-line px-2.5 py-0.5">
                          {t(`rightNames.${r}`)}
                        </span>
                      ))
                    ))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-pill border px-2.5 py-0.5 text-caption ${m.isActive ? 'border-line' : 'border-danger text-danger'}`}
                >
                  {m.isActive ? t('active') : t('inactive')}
                </span>
                <button
                  type="button"
                  className={secondary}
                  aria-expanded={editing === m.id}
                  onClick={() => setEditing(editing === m.id ? null : m.id)}
                >
                  {t('edit')}
                </button>
              </div>
            </div>
            {editing === m.id && (
              <MemberEditor
                member={m}
                isMe={m.id === meId}
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

function MemberEditor({
  member,
  isMe,
  onDone,
}: {
  member: TeamMember;
  isMe: boolean;
  onDone(notice: string): void;
}) {
  const t = useTranslations('merchant.team');
  const errorText = useErrors();
  const [role, setRole] = useState<MerchantTeamRole>(member.merchantRole);
  const [rights, setRights] = useState<MerchantRightName[]>(member.merchantRights);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = (list: MerchantRightName[]) => MERCHANT_RIGHTS.filter((r) => list.includes(r));
  const dirty =
    role !== member.merchantRole ||
    (role === 'member' && sorted(rights).join() !== sorted(member.merchantRights).join());

  async function run(method: 'PATCH' | 'POST', path: string, body: unknown, notice: string) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    onDone(notice);
  }

  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            'PATCH',
            `/merchant/team/${member.id}`,
            { merchantRole: role, ...(role === 'member' && { merchantRights: sorted(rights) }) },
            t('saved'),
          );
        }}
      >
        {isMe ? (
          <p className="rounded-md bg-surface-raised px-3 py-2 text-body-sm">{t('ownNote')}</p>
        ) : (
          <RoleAndRights
            name={member.id}
            role={role}
            rights={rights}
            onRole={setRole}
            onRights={setRights}
          />
        )}
        {!isMe && (
          <FormFooter
            dirty={dirty}
            busy={busy}
            disabled={!dirty}
            onCancel={() => {
              setRole(member.merchantRole);
              setRights(member.merchantRights);
            }}
          />
        )}
      </form>
      <div className="space-y-3">
        <label className="block text-caption">
          {t('newPassword')}
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
            void run('POST', `/merchant/team/${member.id}/password`, { password }, t('passwordSet'))
          }
        >
          {t('setPassword')}
        </button>
        {!isMe && (
          <div>
            <button
              type="button"
              disabled={busy}
              className={`${secondary} ${member.isActive ? 'text-danger' : ''}`}
              onClick={() => {
                if (member.isActive && !window.confirm(t('disableConfirm', { name: member.name })))
                  return;
                void (member.isActive
                  ? run('POST', `/merchant/team/${member.id}/disable`, {}, t('disabled'))
                  : run('PATCH', `/merchant/team/${member.id}`, { isActive: true }, t('enabled')));
              }}
            >
              {member.isActive ? t('disable') : t('enable')}
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
