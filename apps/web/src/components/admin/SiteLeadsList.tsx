'use client';

import { SITE_LEAD_STATUSES, type SiteLeadStatus } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';

export interface SiteLeadRow {
  id: string;
  name: string;
  phone: string;
  phoneValid: boolean;
  website: string | null;
  ordersBand: string;
  locale: string;
  status: SiteLeadStatus;
  note: string | null;
  createdAt: string;
  handledBy: { id: string; name: string } | null;
}

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** One lead: contact details, and for merchants use its status and note. */
function LeadItem({ lead, canEdit }: { lead: SiteLeadRow; canEdit: boolean }) {
  const t = useTranslations('admin.leads');
  const bands = useTranslations('site.contact.bands');
  const locale = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<SiteLeadStatus>(lead.status);
  const [note, setNote] = useState(lead.note ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  const dirty = status !== lead.status || note.trim() !== (lead.note ?? '');

  async function save() {
    setState('busy');
    const result = await apiSend('PATCH', `/admin/site-leads/${lead.id}`, { status, note });
    if (!result.ok) return setState('error');
    setState('saved');
    router.refresh();
  }

  const website = lead.website
    ? /^https?:\/\//i.test(lead.website)
      ? lead.website
      : `https://${lead.website}`
    : null;
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body font-bold">{lead.name}</p>
        <span className="rounded-full bg-surface-raised px-3 py-1 text-caption font-bold">
          {t(`statuses.${lead.status}`)}
        </span>
      </div>
      <p className="text-body-sm [overflow-wrap:anywhere]">
        <a
          href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
          className="ltr-iso font-bold text-link"
        >
          {lead.phone}
        </a>
        {!lead.phoneValid && (
          <span className="ms-2 rounded-full bg-status-needs-action/15 px-2 py-0.5 text-caption font-bold text-status-needs-action">
            {t('phoneFlag')}
          </span>
        )}
      </p>
      <dl className="grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-muted">{t('website')}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="ltr-iso text-link"
              >
                {lead.website}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('orders')}</dt>
          <dd>{bands.has(lead.ordersBand) ? bands(lead.ordersBand) : lead.ordersBand}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('language')}</dt>
          <dd>{lead.locale === 'ar' ? t('languages.ar') : t('languages.en')}</dd>
        </div>
      </dl>
      <p className="text-caption text-text-muted">
        <span className="ltr-iso">
          {t('received', { date: formatCairoDateTime(lead.createdAt, locale) })}
        </span>
        {lead.handledBy && <> · {t('handledBy', { name: lead.handledBy.name })}</>}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="text-caption">
            {t('status')}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SiteLeadStatus)}
              className={`${field} mt-1 block`}
            >
              {SITE_LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-56 flex-1 text-caption">
            {t('note')}
            <input
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              className={`${field} mt-1 block w-full`}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || state === 'busy'}
            onClick={() => void save()}
          >
            {t('save')}
          </button>
          {state === 'saved' && !dirty && (
            <span role="status" className="text-body-sm text-text-muted">
              {t('saved')}
            </span>
          )}
          {state === 'error' && (
            <span role="alert" className="text-body-sm text-danger">
              {t('error')}
            </span>
          )}
        </div>
      ) : (
        lead.note && <p className="text-body-sm">{lead.note}</p>
      )}
    </li>
  );
}

/** Leads from the website's contact form, newest first. */
export function SiteLeadsList({ leads, canEdit }: { leads: SiteLeadRow[]; canEdit: boolean }) {
  const t = useTranslations('admin.leads');
  if (leads.length === 0) return <p className="mt-6 text-body text-text-muted">{t('empty')}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {leads.map((lead) => (
        <LeadItem key={lead.id} lead={lead} canEdit={canEdit} />
      ))}
    </ul>
  );
}
