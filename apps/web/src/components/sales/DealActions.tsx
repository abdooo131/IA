'use client';

import { CRM_STAGES, type CrmStage } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { parseEgp } from '@/lib/money';
import type { LostReason, Person } from '@/lib/sales';
import { LostDialog } from './LostDialog';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/** Change the stage (lost asks for a reason) and, for managers, the owner. */
export function DealStageActions({
  dealId,
  company,
  stage,
  lostReasons,
  ownerId,
  people,
  canManage,
}: {
  dealId: string;
  company: string;
  stage: CrmStage;
  lostReasons: LostReason[];
  ownerId: string | null;
  people: Person[];
  canManage: boolean;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [losing, setLosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorText = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');

  async function move(next: CrmStage, lost?: { reason: string; note: string }) {
    if (next === stage) return;
    if (next === 'lost' && !lost) return setLosing(true);
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/sales/deals/${dealId}/stage`, {
      stage: next,
      ...(lost && { lostReason: lost.reason, lostNote: lost.note || null }),
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    setLosing(false);
    router.refresh();
  }
  async function assign(next: string) {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/sales/deals/${dealId}/owner`, {
      ownerId: next || null,
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    router.refresh();
  }

  const open = stage !== 'won' && stage !== 'lost';
  const nextStage = open ? CRM_STAGES[CRM_STAGES.indexOf(stage) + 1] : undefined;
  return (
    <section className="mt-4 flex flex-wrap items-end gap-2" aria-label={t('deal.actions')}>
      {nextStage && nextStage !== 'lost' && (
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void move(nextStage)}
        >
          {t('deal.moveNext', { stage: t(`stages.${nextStage}`) })}
        </button>
      )}
      {open && (
        <button
          type="button"
          className="h-10 rounded-md border border-danger px-4 font-bold text-danger disabled:opacity-50"
          disabled={busy}
          onClick={() => setLosing(true)}
        >
          {t('deal.markLost')}
        </button>
      )}
      <label className="flex flex-col text-caption">
        <span className="text-text-muted">{t('deal.stage')}</span>
        <select
          className="h-10 rounded-md border border-line-strong bg-surface px-2 text-body-sm"
          value={stage}
          disabled={busy}
          onChange={(e) => void move(e.target.value as CrmStage)}
        >
          {CRM_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`stages.${s}`)}
            </option>
          ))}
        </select>
      </label>
      {canManage && (
        <label className="flex flex-col text-caption">
          <span className="text-text-muted">{t('deal.owner')}</span>
          <select
            className="h-10 rounded-md border border-line-strong bg-surface px-2 text-body-sm"
            value={ownerId ?? ''}
            disabled={busy}
            onChange={(e) => void assign(e.target.value)}
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
      {error && !losing && (
        <p role="alert" className="w-full text-body-sm text-danger">
          {error}
        </p>
      )}
      {losing && (
        <LostDialog
          company={company}
          reasons={lostReasons}
          busy={busy}
          error={error}
          onCancel={() => {
            setLosing(false);
            setError(null);
          }}
          onConfirm={(reason, note) => void move('lost', { reason, note })}
        />
      )}
    </section>
  );
}

/** Edit the deal's own numbers: title, orders a month, monthly fee value, expected close. */
export function DealDetailsForm({
  dealId,
  initial,
}: {
  dealId: string;
  initial: {
    title: string | null;
    expectedMonthlyOrders: number | null;
    expectedMonthlyFeePiastres: number | null;
    expectedCloseDate: string | null;
  };
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const start = {
    title: initial.title ?? '',
    orders: initial.expectedMonthlyOrders === null ? '' : String(initial.expectedMonthlyOrders),
    fee:
      initial.expectedMonthlyFeePiastres === null
        ? ''
        : (initial.expectedMonthlyFeePiastres / 100).toFixed(2),
    close: initial.expectedCloseDate ?? '',
  };
  const [values, setValues] = useState(start);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(start);

  async function save() {
    const orders = values.orders.trim() === '' ? null : Number(values.orders);
    const fee = values.fee.trim() === '' ? null : parseEgp(values.fee);
    if (
      (orders !== null && !Number.isInteger(orders)) ||
      (values.fee.trim() !== '' && fee === null)
    )
      return setError(t('errors.validation_failed'));
    setBusy(true);
    const result = await apiSend('PATCH', `/sales/deals/${dealId}`, {
      title: values.title,
      expectedMonthlyOrders: orders,
      expectedMonthlyFeePiastres: fee,
      expectedCloseDate: values.close || null,
    });
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    setEditing(false);
    setError(null);
    router.refresh();
  }

  if (!editing)
    return (
      <button type="button" className="btn-secondary mt-3" onClick={() => setEditing(true)}>
        {t('deal.edit')}
      </button>
    );
  return (
    <form
      className="mt-3 grid max-w-3xl gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="text-body-sm sm:col-span-2">
        <span className="font-semibold">{t('fields.title')}</span>
        <input
          className={`${field} mt-1`}
          value={values.title}
          maxLength={160}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
        />
      </label>
      <label className="text-body-sm">
        <span className="font-semibold">{t('fields.expectedOrders')}</span>
        <input
          className={`${field} mt-1`}
          inputMode="numeric"
          value={values.orders}
          onChange={(e) => setValues({ ...values, orders: e.target.value })}
        />
      </label>
      <label className="text-body-sm">
        <span className="font-semibold">{t('fields.expectedFee')}</span>
        <input
          className={`${field} mt-1`}
          inputMode="decimal"
          value={values.fee}
          onChange={(e) => setValues({ ...values, fee: e.target.value })}
        />
      </label>
      <label className="text-body-sm">
        <span className="font-semibold">{t('fields.expectedClose')}</span>
        <DateInput
          value={values.close}
          onChange={(e) => setValues({ ...values, close: e.target.value })}
          className="mt-1"
        />
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
            setValues(start);
            setEditing(false);
          }}
        />
      </div>
    </form>
  );
}
