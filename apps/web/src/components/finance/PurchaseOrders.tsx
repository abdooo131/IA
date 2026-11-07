'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import type { BookAccount, StoreOption, SupplierRow } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import type { PackagingItem, PurchaseOrderDetail } from '@/lib/purchasing-types';
import { ReceiptField } from './ReceiptField';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function useErrors() {
  const t = useTranslations('purchasing');
  return (error: string) => (t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic'));
}

const named = (locale: string, a: { code?: string; nameEn: string; nameAr: string }) =>
  `${a.code ? `${a.code} ` : ''}${locale === 'ar' ? a.nameAr : a.nameEn}`;

interface LineDraft {
  kind: 'packaging' | 'expense';
  ref: string;
  description: string;
  quantity: string;
  price: string;
}
const emptyLine = (): LineDraft => ({
  kind: 'packaging',
  ref: '',
  description: '',
  quantity: '1',
  price: '',
});

/** A new purchase order: supplier, store, lines (packaging or a cost), note and the quote. */
export function NewPurchaseOrder({
  suppliers,
  stores,
  items,
  accounts,
}: {
  suppliers: SupplierRow[];
  stores: StoreOption[];
  items: PackagingItem[];
  accounts: BookAccount[];
}) {
  const t = useTranslations('purchasing.orders');
  const errorText = useErrors();
  const locale = useLocale();
  const router = useRouter();
  const expenses = accounts.filter(
    (a) => a.isActive && (a.groupCode === 5400 || a.groupCode === 5500),
  );
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = supplierId !== '' || lines.some((l) => l.ref || l.description || l.price);

  const change = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({
    ...l,
    qty: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : null,
    unit: parseEgp(l.price),
  }));
  const total = parsed.reduce((s, l) => s + (l.qty ?? 0) * (l.unit ?? 0), 0);
  const valid =
    supplierId &&
    parsed.every((l) => l.ref && l.description.trim().length >= 2 && l.qty && l.unit !== null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/finance/purchase-orders', {
      supplierId,
      ...(storeId ? { darkStoreId: storeId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(photoId ? { quotePhotoId: photoId } : {}),
      lines: parsed.map((l) => ({
        ...(l.kind === 'packaging' ? { packagingItemId: l.ref } : { expenseAccountId: l.ref }),
        description: l.description.trim(),
        quantity: l.qty,
        unitPricePiastres: l.unit,
      })),
      idempotencyKey: newActionKey(),
    });
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    router.push(`/finance/purchase-orders/${result.data.id}`);
  }

  return (
    <section className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('new')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('supplier')}>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={field}
          >
            <option value="">{t('choose')}</option>
            {suppliers
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('store')}>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
            <option value="">{t('noStore')}</option>
            {stores
              .filter((s) => s.kind === 'dark_store')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {named(locale, s)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <ul className="space-y-3">
        {lines.map((l, i) => (
          <li key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-6">
            <Field label={t('lineKind')}>
              <select
                value={l.kind}
                onChange={(e) => change(i, { kind: e.target.value as LineDraft['kind'], ref: '' })}
                className={field}
              >
                <option value="packaging">{t('packagingLine')}</option>
                <option value="expense">{t('expenseLine')}</option>
              </select>
            </Field>
            <Field label={l.kind === 'packaging' ? t('item') : t('expense')}>
              <select
                value={l.ref}
                onChange={(e) => {
                  const item = items.find((x) => x.id === e.target.value);
                  change(i, {
                    ref: e.target.value,
                    ...(item && !l.description ? { description: named(locale, item) } : {}),
                  });
                }}
                className={field}
              >
                <option value="">{t('choose')}</option>
                {(l.kind === 'packaging' ? items.filter((x) => x.isActive) : expenses).map((x) => (
                  <option key={x.id} value={x.id}>
                    {named(locale, x)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('description')}>
                <input
                  value={l.description}
                  onChange={(e) => change(i, { description: e.target.value })}
                  className={field}
                />
              </Field>
            </div>
            <Field label={t('quantity')}>
              <input
                value={l.quantity}
                onChange={(e) => change(i, { quantity: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                className={`${field} text-end`}
              />
            </Field>
            <Field label={t('unitPrice')}>
              <input
                value={l.price}
                onChange={(e) => change(i, { price: e.target.value })}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.00"
                className={`${field} text-end`}
              />
            </Field>
            {lines.length > 1 && (
              <button
                type="button"
                className={`${secondary} sm:col-span-6 sm:justify-self-end`}
                onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
              >
                {t('removeLine')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={secondary}
        onClick={() => setLines((all) => [...all, emptyLine()])}
      >
        {t('addLine')}
      </button>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('note')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </Field>
        <Field label={t('quote')}>
          <ReceiptField onChange={setPhotoId} />
        </Field>
      </div>
      <p className="text-body-sm">
        {t('total')}: <span className="font-bold">{formatEgp(total)}</span>
      </p>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter
        dirty={dirty}
        busy={busy}
        disabled={!valid}
        onSave={() => void save()}
        onCancel={() => {
          setSupplierId('');
          setStoreId('');
          setNote('');
          setLines([emptyLine()]);
        }}
      />
    </section>
  );
}

/** What can be done with an order now: approve, mark ordered, receive, bill, close. */
export function PurchaseOrderActions({
  order,
  canApprove,
}: {
  order: PurchaseOrderDetail;
  canApprove: boolean;
}) {
  const t = useTranslations('purchasing.orders');
  const errorText = useErrors();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [receive, setReceive] = useState<Record<string, string>>({});
  const [bill, setBill] = useState({
    reference: '',
    billDate: cairoDay(new Date()),
    dueDate: cairoDay(new Date()),
    net: (order.unbilledPiastres / 100).toFixed(2),
    vat: '0.00',
  });

  async function send(path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend('POST', `/finance/purchase-orders/${order.id}/${path}`, body);
    setBusy(false);
    setMessage(
      result.ok ? { text: done, error: false } : { text: errorText(result.error), error: true },
    );
    if (result.ok) router.refresh();
  }

  const open = order.lines.filter((l) => l.receivedQty < l.quantity);
  const closed = ['closed', 'rejected', 'cancelled'].includes(order.status);
  return (
    <section className="mt-6 space-y-4">
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}

      {order.status === 'requested' && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('decide')}</h2>
          {canApprove ? (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('decisionNote')}
                aria-label={t('decisionNote')}
                className={field}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() => void send('decide', { approve: true, note }, t('approved'))}
                >
                  {t('approve')}
                </button>
                <button
                  type="button"
                  className={`${secondary} text-danger`}
                  disabled={busy || note.trim().length < 3}
                  onClick={() => void send('decide', { approve: false, note }, t('rejected'))}
                >
                  {t('reject')}
                </button>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{t('waitingApproval')}</p>
          )}
        </div>
      )}

      {order.status === 'approved' && (
        <button
          type="button"
          className={primary}
          disabled={busy}
          onClick={() => void send('ordered', {}, t('markedOrdered'))}
        >
          {t('markOrdered')}
        </button>
      )}

      {order.status === 'ordered' && open.length > 0 && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('receive')}</h2>
          <p className="text-caption text-text-muted">{t('receiveHint')}</p>
          {open.map((l) => (
            <label key={l.id} className="flex flex-wrap items-center gap-2 text-body-sm">
              <span className="min-w-40 flex-1">
                {l.description}{' '}
                <span className="text-text-muted">
                  ({t('left', { count: l.quantity - l.receivedQty })})
                </span>
              </span>
              <input
                value={receive[l.id] ?? ''}
                onChange={(e) => setReceive((r) => ({ ...r, [l.id]: e.target.value }))}
                inputMode="numeric"
                dir="ltr"
                placeholder="0"
                className="h-10 w-28 rounded-md border border-line bg-surface px-2 text-end"
              />
            </label>
          ))}
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => {
              const lines = Object.entries(receive)
                .filter(([, v]) => /^\d+$/.test(v.trim()) && Number(v) > 0)
                .map(([lineId, v]) => ({ lineId, quantity: Number(v) }));
              if (!lines.length) return;
              void send(
                'receive',
                { lines, idempotencyKey: newActionKey() },
                t('receivedMsg'),
              ).then(() => setReceive({}));
            }}
          >
            {t('receiveButton')}
          </button>
        </div>
      )}

      {(order.status === 'ordered' || order.status === 'received') &&
        order.unbilledPiastres > 0 && (
          <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-h3">{t('bill')}</h2>
            <p className="text-caption text-text-muted">
              {t('billHint', {
                expected: formatEgp(order.unbilledPiastres),
                max: formatEgp(order.maxBillPiastres),
              })}
            </p>
            <div className="grid gap-2 sm:grid-cols-5">
              <Field label={t('supplierInvoice')}>
                <input
                  value={bill.reference}
                  onChange={(e) => setBill({ ...bill, reference: e.target.value })}
                  className={field}
                />
              </Field>
              <Field label={t('billDate')}>
                <DateInput
                  value={bill.billDate}
                  onChange={(e) => setBill({ ...bill, billDate: e.target.value })}
                  className={field}
                />
              </Field>
              <Field label={t('dueDate')}>
                <DateInput
                  value={bill.dueDate}
                  onChange={(e) => setBill({ ...bill, dueDate: e.target.value })}
                  className={field}
                />
              </Field>
              <Field label={t('net')}>
                <input
                  value={bill.net}
                  onChange={(e) => setBill({ ...bill, net: e.target.value })}
                  inputMode="decimal"
                  dir="ltr"
                  className={`${field} text-end`}
                />
              </Field>
              <Field label={t('vat')}>
                <input
                  value={bill.vat}
                  onChange={(e) => setBill({ ...bill, vat: e.target.value })}
                  inputMode="decimal"
                  dir="ltr"
                  className={`${field} text-end`}
                />
              </Field>
            </div>
            <button
              type="button"
              className={primary}
              disabled={busy || bill.reference.trim().length < 2 || parseEgp(bill.net) === null}
              onClick={() =>
                void send(
                  'bill',
                  {
                    reference: bill.reference.trim(),
                    billDate: bill.billDate,
                    dueDate: bill.dueDate,
                    netPiastres: parseEgp(bill.net),
                    vatPiastres: parseEgp(bill.vat) ?? 0,
                    idempotencyKey: newActionKey(),
                  },
                  t('billed'),
                )
              }
            >
              {t('makeBill')}
            </button>
          </div>
        )}

      {!closed && (
        <div className="flex flex-wrap items-end gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('closeNote')}
            aria-label={t('closeNote')}
            className="h-10 min-w-56 flex-1 rounded-md border border-line bg-surface px-2 text-body-sm"
          />
          <button
            type="button"
            className={secondary}
            disabled={busy || note.trim().length < 3}
            onClick={() => void send('close', { note: note.trim() }, t('closedMsg'))}
          >
            {order.lines.some((l) => l.receivedQty > 0) ? t('close') : t('cancelOrder')}
          </button>
        </div>
      )}
    </section>
  );
}
