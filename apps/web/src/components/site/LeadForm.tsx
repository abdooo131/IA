'use client';

import { ORDERS_BANDS, siteLeadFieldErrors } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';

const FIELD_ERRORS = [
  'name_required',
  'name_too_long',
  'phone_required',
  'phone_short',
  'phone_too_long',
  'website_too_long',
  'orders_band_required',
];
type Field = 'name' | 'phone' | 'website' | 'ordersBand';

/**
 * The website's contact form. It sends one lead per submission: the idempotency key is made
 * once and reused on a retry, the button is off while sending, and a second tap is ignored.
 */
export function LeadForm() {
  const t = useTranslations('site.contact');
  const locale = useLocale();
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const sending = useRef(false);
  const key = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const form = new FormData(event.currentTarget);
    key.current ??= newActionKey();
    const body = {
      name: String(form.get('name') ?? ''),
      phone: String(form.get('phone') ?? ''),
      website: String(form.get('website') ?? ''),
      ordersBand: String(form.get('ordersBand') ?? ''),
      locale: locale === 'ar' ? 'ar' : 'en',
      idempotencyKey: key.current,
    };
    const local = siteLeadFieldErrors(body);
    setFormError(null);
    if (local) {
      setErrors(local);
      return;
    }
    setErrors({});
    sending.current = true;
    setBusy(true);
    const result = await apiSend<{ id: string }>('POST', '/site/leads', body);
    sending.current = false;
    setBusy(false);
    if (result.ok) return setDone(true);
    const issues = (result.details?.issues ?? []) as { path: string; message: string }[];
    const fields = Object.fromEntries(
      issues.filter((i) => FIELD_ERRORS.includes(i.message)).map((i) => [i.path, i.message]),
    );
    if (Object.keys(fields).length) return setErrors(fields);
    setFormError(
      result.error === 'too_many_attempts' || result.error === 'http_429'
        ? 'too_many_attempts'
        : 'generic',
    );
  }

  if (done)
    return (
      <p className="s-form-done" role="status">
        {t('done')}
      </p>
    );

  const invalid = (field: Field) =>
    errors[field]
      ? { 'aria-invalid': true as const, 'aria-describedby': `lead-${field}-error` }
      : {};
  const problem = (field: Field) =>
    errors[field] ? (
      <span id={`lead-${field}-error`} className="s-field-error">
        {t(`errors.${errors[field]}`)}
      </span>
    ) : null;

  return (
    <div className="s-form-wrap">
      <form className="s-lead-form" onSubmit={submit} noValidate>
        <div className="s-row">
          <label htmlFor="lead-name">
            <span>{t('name')}</span>
            <input
              id="lead-name"
              name="name"
              required
              maxLength={120}
              autoComplete="name"
              {...invalid('name')}
            />
            {problem('name')}
          </label>
          <label htmlFor="lead-phone">
            <span>{t('phone')}</span>
            <input
              id="lead-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              required
              maxLength={40}
              placeholder={t('phonePlaceholder')}
              autoComplete="tel"
              {...invalid('phone')}
            />
            {problem('phone')}
          </label>
        </div>
        <label htmlFor="lead-website">
          <span>{t('store')}</span>
          <input
            id="lead-website"
            name="website"
            dir="ltr"
            maxLength={200}
            placeholder={t('storePlaceholder')}
            autoComplete="url"
            {...invalid('website')}
          />
          {problem('website')}
        </label>
        <label htmlFor="lead-orders">
          <span>{t('orders')}</span>
          <select id="lead-orders" name="ordersBand" {...invalid('ordersBand')}>
            {ORDERS_BANDS.map((band) => (
              <option key={band} value={band}>
                {t(`bands.${band}`)}
              </option>
            ))}
          </select>
          {problem('ordersBand')}
        </label>
        <button className="s-btn" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? t('sending') : t('send')}
        </button>
        {formError && (
          <p className="s-field-error" role="alert">
            {t(`errors.${formError}`)}
          </p>
        )}
      </form>
      <p className="s-account">
        {t('accountPrompt')} <Link href="/signup">{t('createAccount')}</Link>
      </p>
    </div>
  );
}
