'use client';

import { ACCOUNT_CATEGORIES, ACCOUNT_GROUPS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import type { BookAccount } from '@/lib/finance-types';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'h-9 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const OPEN_GROUPS = ACCOUNT_GROUPS.filter((g) => g.manualType);

const name = (a: { nameEn: string; nameAr: string }, locale: string) =>
  locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn;

/** Opens a new account; its code comes from the group's sequence. */
function NewAccount({ onDone }: { onDone: () => void }) {
  const t = useTranslations('finance.accounts');
  const action = useFinanceAction();
  const [group, setGroup] = useState(OPEN_GROUPS[0]!.code);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim() || undefined;
    const result = await action.send<{ code: string }>(
      'POST',
      '/finance/accounts',
      {
        groupCode: group,
        nameEn: text('nameEn'),
        nameAr: text('nameAr'),
        bankName: text('bankName'),
        accountNumber: text('accountNumber'),
        iban: text('iban'),
        note: text('note'),
      },
      (d) => t('created', { code: d.code }),
    );
    if (result) onDone();
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-h3">{t('new')}</h2>
      <label className="block text-caption">
        {t('group')}
        <select value={group} onChange={(e) => setGroup(Number(e.target.value))} className={field}>
          {OPEN_GROUPS.map((g) => (
            <option key={g.code} value={g.code}>
              {g.code} · {t(`groups.${g.key}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-caption text-text-muted">{t('codeHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-caption">
          {t('nameEn')}
          <input name="nameEn" required minLength={2} dir="ltr" className={field} />
        </label>
        <label className="block text-caption">
          {t('nameAr')}
          <input name="nameAr" required minLength={2} dir="rtl" className={field} />
        </label>
        {group === 1100 && (
          <>
            <label className="block text-caption">
              {t('bankName')}
              <input name="bankName" required dir="ltr" placeholder="CIB" className={field} />
            </label>
            <label className="block text-caption">
              {t('accountNumber')}
              <input name="accountNumber" required dir="ltr" className={field} />
            </label>
            <label className="block text-caption sm:col-span-2">
              {t('iban')}
              <input
                name="iban"
                dir="ltr"
                placeholder="EG00 0000 0000 0000 0000 0000 0000 0"
                className={field}
              />
            </label>
          </>
        )}
        <label className="block text-caption sm:col-span-2">
          {t('note')}
          <input name="note" className={field} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={action.busy}>
          {t('open')}
        </button>
        <button type="button" className={button} onClick={onDone}>
          {t('close')}
        </button>
      </div>
      <ActionMessage message={action.message} />
    </form>
  );
}

function EditAccount({ account, onDone }: { account: BookAccount; onDone: () => void }) {
  const t = useTranslations('finance.accounts');
  const action = useFinanceAction();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => (f.has(k) ? String(f.get(k) ?? '').trim() : undefined);
    const ok = await action.send('PATCH', `/finance/accounts/${account.id}`, {
      nameEn: account.wallet ? undefined : text('nameEn'),
      nameAr: account.wallet ? undefined : text('nameAr'),
      bankName: text('bankName'),
      accountNumber: text('accountNumber'),
      iban: text('iban'),
      note: text('note'),
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 grid gap-2 sm:grid-cols-2">
      {!account.wallet && (
        <>
          <label className="block text-caption">
            {t('nameEn')}
            <input name="nameEn" defaultValue={account.nameEn} dir="ltr" className={field} />
          </label>
          <label className="block text-caption">
            {t('nameAr')}
            <input name="nameAr" defaultValue={account.nameAr} dir="rtl" className={field} />
          </label>
        </>
      )}
      {account.groupCode === 1100 && (
        <>
          <label className="block text-caption">
            {t('bankName')}
            <input
              name="bankName"
              defaultValue={account.bankName ?? ''}
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption">
            {t('accountNumber')}
            <input
              name="accountNumber"
              defaultValue={account.accountNumber ?? ''}
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption sm:col-span-2">
            {t('iban')}
            <input name="iban" defaultValue={account.iban ?? ''} dir="ltr" className={field} />
          </label>
        </>
      )}
      <label className="block text-caption sm:col-span-2">
        {t('note')}
        <input name="note" defaultValue={account.note ?? ''} className={field} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primary} disabled={action.busy}>
          {t('save')}
        </button>
        <button type="button" className={button} onClick={onDone}>
          {t('close')}
        </button>
      </div>
      <ActionMessage message={action.message} />
    </form>
  );
}

function AccountRow({ account }: { account: BookAccount }) {
  const t = useTranslations('finance.accounts');
  const locale = useLocale();
  const action = useFinanceAction();
  const [editing, setEditing] = useState(false);
  const bank = [account.bankName, account.accountNumber, account.iban].filter(Boolean).join(' · ');
  return (
    <li className={`py-2 ${account.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="ltr-iso w-24 shrink-0 font-bold text-link">{account.code}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/finance/accounts/${account.id}`} className="font-bold text-link">
            {name(account, locale)}
          </Link>
          {!account.isActive && (
            <span className="ms-2 rounded-pill border border-line px-2 text-caption">
              {t('closed')}
            </span>
          )}
          {bank && <p className="ltr-iso text-caption text-text-muted">{bank}</p>}
          {account.note && <p className="text-caption text-text-muted">{account.note}</p>}
        </div>
        <span className="text-end">
          <Amount piastres={account.balancePiastres} strong />
        </span>
        <div className="flex gap-1">
          <button type="button" className={button} onClick={() => setEditing(!editing)}>
            {t('edit')}
          </button>
          {!account.locked && (
            <button
              type="button"
              className={button}
              disabled={action.busy}
              onClick={() => {
                if (account.isActive && !window.confirm(t('closeConfirm'))) return;
                void action.send('PATCH', `/finance/accounts/${account.id}`, {
                  isActive: !account.isActive,
                });
              }}
            >
              {account.isActive ? t('closeAccount') : t('reopen')}
            </button>
          )}
        </div>
      </div>
      {editing && <EditAccount account={account} onDone={() => setEditing(false)} />}
      <ActionMessage message={action.message} />
    </li>
  );
}

/** The chart of accounts by category and group, with balances. */
export function AccountsManager({
  accounts,
  showClosed,
}: {
  accounts: BookAccount[];
  showClosed: boolean;
}) {
  const t = useTranslations('finance.accounts');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = q
    ? accounts.filter((a) =>
        [a.code, a.nameEn, a.nameAr, a.bankName ?? '', a.accountNumber ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : accounts;

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <button type="button" className={primary} onClick={() => setAdding(true)}>
            {t('new')}
          </button>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-10 w-64 rounded-md border border-line bg-surface px-3 text-body-sm"
        />
        <Link
          href={showClosed ? '/finance/accounts' : '/finance/accounts?all=true'}
          className="text-body-sm text-link"
        >
          {showClosed ? t('hideClosed') : t('showClosed')}
        </Link>
      </div>
      {adding && <NewAccount onDone={() => setAdding(false)} />}

      {ACCOUNT_CATEGORIES.map((category) => {
        const groups = ACCOUNT_GROUPS.filter((g) => g.category === category);
        const inCategory = shown.filter((a) => a.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} className="rounded-lg border border-line bg-surface p-4">
            <h2 className="text-h3">
              <span className="ltr-iso me-2 text-text-muted">
                {ACCOUNT_CATEGORIES.indexOf(category) + 1}000
              </span>
              {t(`categories.${category}`)}
            </h2>
            {groups.map((g) => {
              const rows = inCategory.filter((a) => a.groupCode === g.code);
              if (rows.length === 0) return null;
              return (
                <div key={g.code} className="mt-3">
                  <h3 className="text-body-sm font-bold text-text-muted">
                    <span className="ltr-iso">{g.code}</span> · {t(`groups.${g.key}`)}
                  </h3>
                  <ul className="divide-y divide-line">
                    {rows.map((a) => (
                      <AccountRow key={a.id} account={a} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
