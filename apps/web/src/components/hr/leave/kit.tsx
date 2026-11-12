'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Pill } from '@/components/orders/detail/Card';
import { apiSend } from '@/lib/api-client';
import { statusTone } from '@/lib/leave';

// Shared pieces of the HR phase 3 screens: one way to send an action and show its refusal, the
// status pill, field styles and names in the page's language.

export const field =
  'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
/** A date box (DateInput keeps its own width). */
export const dateField =
  'h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
export const area =
  'min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body-sm text-text';
export const primary =
  'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50';
export const secondary =
  'inline-flex h-10 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-body-sm font-bold text-text disabled:opacity-50';
export const danger =
  'inline-flex h-10 items-center justify-center rounded-md border border-danger bg-surface px-4 text-body-sm font-bold text-danger disabled:opacity-50';
export const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
export const td = 'px-3 py-2 align-top';
export const panel = 'mt-4 rounded-lg border border-line bg-surface p-4';

/** A person or type name in the page's language (Arabic falls back to English). */
export function useName() {
  const locale = useLocale();
  return (x: { nameEn: string; nameAr: string | null } | null | undefined) =>
    x ? (locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn) : '–';
}

/** Sends one action; a refusal shows its own message (hr3.errors.<code>) or a general one. */
export function useAction() {
  const t = useTranslations('hr3');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const explain = (code: string, details?: Record<string, unknown>) => {
    const values = Object.fromEntries(
      Object.entries(details ?? {}).filter(([, v]) => typeof v !== 'object'),
    ) as Record<string, string | number>;
    return t.has(`errors.${code}`) ? t(`errors.${code}`, values) : t('errors.generic');
  };
  async function send<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    message?: string,
  ): Promise<T | null> {
    setBusy(true);
    setError(null);
    setDone(null);
    const result = await apiSend<T>(method, path, body);
    setBusy(false);
    if (!result.ok) {
      setError(explain(result.error, result.details));
      return null;
    }
    if (message) setDone(message);
    router.refresh();
    return result.data;
  }
  /** Uploads a photo or PDF as the raw body (a medical note, evidence). */
  async function upload(path: string, file: File, message?: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api${path}?name=${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      if (!res.ok) {
        setError(explain(data.error ?? (res.status === 413 ? 'document_too_large' : 'generic')));
        return false;
      }
      if (message) setDone(message);
      router.refresh();
      return true;
    } catch {
      setBusy(false);
      setError(explain('network'));
      return false;
    }
  }
  return { busy, error, done, send, upload, setError };
}

export function Feedback({ error, done }: { error: string | null; done?: string | null }) {
  if (error)
    return (
      <p role="alert" className="mt-2 text-body-sm text-danger">
        {error}
      </p>
    );
  if (done)
    return (
      <p role="status" className="mt-2 text-body-sm text-status-delivered">
        {done}
      </p>
    );
  return null;
}

/** The status of a request, violation, suggestion or correction as a coloured pill. */
export function StatePill({ status }: { status: string }) {
  const t = useTranslations('hr3');
  return <Pill tone={statusTone(status)}>{t(`states.${status}`)}</Pill>;
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const day = (d: string) => (
  <span className="ltr-iso whitespace-nowrap">{d.split('-').reverse().join('/')}</span>
);
