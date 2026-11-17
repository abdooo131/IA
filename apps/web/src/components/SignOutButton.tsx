'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { forgetPushDevice } from '@/lib/sign-out';

export function SignOutButton() {
  const t = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // This device stops getting the person's notifications; never blocks signing out.
    await forgetPushDevice();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text"
    >
      {t('signOut')}
    </button>
  );
}
