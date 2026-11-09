'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { toast } from '@/shell/feedback';
import { SETTINGS_MENU } from '../../menu';

interface Role {
  key: string;
  nameEn: string;
  nameAr: string;
}

const ERRORS: Record<string, string> = { invalid_mobile: 'mobileInvalid', login_taken: 'loginTaken' };

export default function NewUserPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Role[]>('/roles').then(setRoles);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const user = await api<{ id: string }>('/users', {
        method: 'POST',
        json: { name: f.name, nameAr: f.nameAr, email: f.email || undefined, mobile: f.mobile || undefined, password: f.password, roleKey: f.roleKey },
      });
      toast.success(t('common.saved'));
      router.push(`/settings/users/${user.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.body.error : undefined;
      setError(code && ERRORS[code] ? t(`settings.${ERRORS[code]}`) : t('common.failed'));
      setBusy(false);
    }
  }

  return (
    <AppShell app="settings" menu={SETTINGS_MENU} need="manage">
      <h1>{t('settings.newUser')}</h1>
      <form className="form card" onSubmit={submit}>
        <label>
          {t('settings.name')}
          <input name="name" required maxLength={120} />
        </label>
        <label>
          {t('settings.nameAr')}
          <input name="nameAr" required maxLength={120} dir="rtl" />
        </label>
        <label>
          {t('settings.email')}
          <input name="email" type="email" dir="ltr" />
        </label>
        <label>
          {t('settings.mobile')}
          <input name="mobile" inputMode="tel" dir="ltr" />
        </label>
        <label>
          {t('settings.role')}
          <select name="roleKey" required defaultValue="">
            <option value="" disabled />
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {locale === 'ar' ? r.nameAr : r.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.password')}
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {t('settings.createUser')}
        </button>
      </form>
    </AppShell>
  );
}
