'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { type Contact, telHref, whatsappHref } from '@/lib/sales';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';
const EMPTY = { name: '', role: '', phone: '', email: '', whatsapp: false };

/** A company's people: tap to call or open WhatsApp; use adds a contact. */
export function Contacts({
  companyId,
  contacts,
  canEdit,
}: {
  companyId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(EMPTY);

  async function save() {
    setBusy(true);
    const result = await apiSend('POST', `/sales/companies/${companyId}/contacts`, {
      name: values.name,
      role: values.role || null,
      phone: values.phone || null,
      email: values.email || null,
      whatsapp: values.whatsapp,
    });
    setBusy(false);
    if (!result.ok)
      return setError(
        t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
      );
    setValues(EMPTY);
    setAdding(false);
    setError(null);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-labelledby="contacts">
      <h2 id="contacts" className="text-h3">
        {t('contacts.title')}
      </h2>
      {contacts.length === 0 && (
        <p className="mt-2 text-body-sm text-text-muted">{t('contacts.none')}</p>
      )}
      <ul className="mt-2 divide-y divide-line">
        {contacts.map((c) => {
          const wa = c.whatsapp ? whatsappHref(c.phone) : null;
          return (
            <li key={c.id} className="py-2 text-body-sm">
              <p className="font-bold">
                {c.name}
                {c.role && <span className="font-normal text-text-muted"> · {c.role}</span>}
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
                {c.phone && (
                  <a href={telHref(c.phone)} className="ltr-iso font-semibold text-link">
                    {c.phone}
                  </a>
                )}
                {c.phone && !c.phoneValid && (
                  <span className="rounded-full bg-status-needs-action/15 px-2 py-0.5 text-caption font-bold text-status-needs-action">
                    {t('contacts.phoneFlag')}
                  </span>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="text-link">
                    {t('contacts.whatsapp')}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="ltr-iso text-link">
                    {c.email}
                  </a>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      {canEdit && !adding && (
        <button
          type="button"
          className="mt-2 text-body-sm font-bold text-link"
          onClick={() => setAdding(true)}
        >
          {t('contacts.add')}
        </button>
      )}
      {adding && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="text-body-sm">
            <span className="font-semibold">{t('fields.contactName')}</span>
            <input
              className={`${field} mt-1`}
              required
              minLength={2}
              maxLength={120}
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
          </label>
          <label className="text-body-sm">
            <span className="font-semibold">{t('fields.contactRole')}</span>
            <input
              className={`${field} mt-1`}
              maxLength={80}
              value={values.role}
              onChange={(e) => setValues({ ...values, role: e.target.value })}
            />
          </label>
          <label className="text-body-sm">
            <span className="font-semibold">{t('fields.phone')}</span>
            <input
              className={`${field} mt-1`}
              type="tel"
              dir="ltr"
              maxLength={40}
              value={values.phone}
              onChange={(e) => setValues({ ...values, phone: e.target.value })}
            />
          </label>
          <label className="text-body-sm">
            <span className="font-semibold">{t('fields.email')}</span>
            <input
              className={`${field} mt-1`}
              type="email"
              dir="ltr"
              maxLength={200}
              value={values.email}
              onChange={(e) => setValues({ ...values, email: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-body-sm sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={values.whatsapp}
              onChange={(e) => setValues({ ...values, whatsapp: e.target.checked })}
            />
            {t('fields.whatsapp')}
          </label>
          {error && (
            <p role="alert" className="text-body-sm text-danger sm:col-span-2">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <FormFooter
              dirty={dirty}
              busy={busy}
              onCancel={() => {
                setValues(EMPTY);
                setAdding(false);
              }}
            />
          </div>
        </form>
      )}
    </section>
  );
}
