'use client';

import { CRM_MANUAL_SOURCES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import type { Person } from '@/lib/sales';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

const EMPTY = {
  brandName: '',
  website: '',
  shopDomain: '',
  category: '',
  city: '',
  source: 'manual',
  contactName: '',
  contactRole: '',
  phone: '',
  email: '',
  whatsapp: true,
  title: '',
  orders: '',
  fee: '',
  close: '',
  ownerId: '',
};

/**
 * A rep adds a lead by hand: the company (or a company we already have), its first contact
 * and the deal's numbers. A rep's lead is theirs; a manager may give it to someone at once.
 */
export function NewDealForm({
  company,
  people,
  manager,
}: {
  company: { id: string; brandName: string } | null;
  people: Person[];
  manager: boolean;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newActionKey());
  const dirty = JSON.stringify(values) !== JSON.stringify(EMPTY);
  const set = (patch: Partial<typeof EMPTY>) => setValues((v) => ({ ...v, ...patch }));

  async function save() {
    const orders = values.orders.trim() === '' ? null : Number(values.orders);
    const fee = values.fee.trim() === '' ? null : parseEgp(values.fee);
    if (
      (orders !== null && (!Number.isInteger(orders) || orders < 0)) ||
      (values.fee.trim() !== '' && fee === null)
    )
      return setError(t('errors.validation_failed'));
    const contact = values.contactName.trim()
      ? {
          name: values.contactName,
          role: values.contactRole || null,
          phone: values.phone || null,
          email: values.email || null,
          whatsapp: values.whatsapp,
        }
      : undefined;
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/sales/deals', {
      ...(company
        ? { companyId: company.id }
        : {
            company: {
              brandName: values.brandName,
              website: values.website || null,
              shopDomain: values.shopDomain || null,
              category: values.category || null,
              city: values.city || null,
              expectedMonthlyOrders: orders,
              source: values.source,
            },
          }),
      ...(contact && { contact }),
      title: values.title || null,
      expectedMonthlyOrders: orders,
      expectedMonthlyFeePiastres: fee,
      expectedCloseDate: values.close || null,
      ...(manager && { ownerId: values.ownerId || null }),
      idempotencyKey: key,
    });
    setBusy(false);
    if (!result.ok)
      return setError(
        t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
      );
    router.push(`/admin/sales/deals/${result.data.id}`);
  }

  const input = (
    name: keyof typeof EMPTY,
    label: string,
    options: {
      required?: boolean;
      type?: string;
      ltr?: boolean;
      max?: number;
      mode?: 'numeric' | 'decimal';
    } = {},
  ) => (
    <label className="text-body-sm">
      <span className="font-semibold">
        {label}
        {options.required && <span aria-hidden> *</span>}
      </span>
      <input
        className={`${field} mt-1`}
        type={options.type ?? 'text'}
        dir={options.ltr ? 'ltr' : undefined}
        inputMode={options.mode}
        required={options.required}
        maxLength={options.max ?? 200}
        value={String(values[name])}
        onChange={(e) => set({ [name]: e.target.value } as Partial<typeof EMPTY>)}
      />
    </label>
  );

  return (
    <form
      className="mt-4 max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <legend className="px-1 text-h3">{t('newDeal.company')}</legend>
        {company ? (
          <p className="text-body font-bold sm:col-span-2">{company.brandName}</p>
        ) : (
          <>
            {input('brandName', t('fields.brandName'), { required: true, max: 120 })}
            <label className="text-body-sm">
              <span className="font-semibold">{t('fields.source')}</span>
              <select
                className={`${field} mt-1`}
                value={values.source}
                onChange={(e) => set({ source: e.target.value })}
              >
                {CRM_MANUAL_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {input('website', t('fields.website'), { ltr: true })}
            {input('shopDomain', t('fields.shopDomain'), { ltr: true })}
            {input('category', t('fields.category'), { max: 80 })}
            {input('city', t('fields.city'), { max: 80 })}
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <legend className="px-1 text-h3">{t('newDeal.contact')}</legend>
        {input('contactName', t('fields.contactName'), { max: 120 })}
        {input('contactRole', t('fields.contactRole'), { max: 80 })}
        {input('phone', t('fields.phone'), { type: 'tel', ltr: true, max: 40 })}
        {input('email', t('fields.email'), { type: 'email', ltr: true })}
        <label className="flex items-center gap-2 text-body-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={values.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.checked })}
          />
          {t('fields.whatsapp')}
        </label>
        <p className="text-caption text-text-muted sm:col-span-2">{t('newDeal.phoneHint')}</p>
      </fieldset>

      <fieldset className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <legend className="px-1 text-h3">{t('newDeal.deal')}</legend>
        <div className="sm:col-span-2">{input('title', t('fields.title'), { max: 160 })}</div>
        {input('orders', t('fields.expectedOrders'), { mode: 'numeric', ltr: true })}
        {input('fee', t('fields.expectedFee'), { mode: 'decimal', ltr: true })}
        <label className="text-body-sm">
          <span className="font-semibold">{t('fields.expectedClose')}</span>
          <DateInput
            value={values.close}
            onChange={(e) => set({ close: e.target.value })}
            className="mt-1"
          />
        </label>
        {manager && (
          <label className="text-body-sm">
            <span className="font-semibold">{t('deal.owner')}</span>
            <select
              className={`${field} mt-1`}
              value={values.ownerId}
              onChange={(e) => set({ ownerId: e.target.value })}
            >
              <option value="">{t('unassigned')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter
        dirty={dirty}
        busy={busy}
        saveLabel={t('newDeal.save')}
        cancelHref={company ? `/admin/sales/companies/${company.id}` : '/admin/sales/leads'}
      />
    </form>
  );
}
