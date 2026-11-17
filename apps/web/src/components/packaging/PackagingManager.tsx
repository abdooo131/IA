'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ReceiptField } from '@/components/finance/ReceiptField';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import type {
  NamedStore,
  PackagingItem,
  PackagingMovementRow,
  PackagingRecipe,
  PackagingStock,
} from '@/lib/purchasing-types';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      {hint && <p className="text-caption text-text-muted">{hint}</p>}
      {children}
    </section>
  );
}

/** Sends one change, shows its result and reloads the page data. */
function useAction() {
  const t = useTranslations('purchasing');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function send(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<{ status?: string }>(method, path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({
        text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
        error: true,
      });
      return false;
    }
    setMessage({
      text: result.data?.status === 'pending' ? t('packaging.sentForApproval') : done,
      error: false,
    });
    router.refresh();
    return true;
  }
  const view = message && (
    <p
      role="status"
      className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
    >
      {message.text}
    </p>
  );
  return { busy, send, view };
}

export interface PackagingPageData {
  items: PackagingItem[];
  stock: PackagingStock;
  recipes: PackagingRecipe[];
  movements: PackagingMovementRow[];
  merchants: { id: string; name: string }[];
  /** Banks and cash boxes, when the person may buy (accounting use) */
  money: { id: string; code: string; nameEn: string; nameAr: string }[] | null;
  canManage: boolean;
  canCount: boolean;
}

export function PackagingManager({ data }: { data: PackagingPageData }) {
  const t = useTranslations('purchasing.packaging');
  const locale = useLocale();
  const name = (a: { code?: string; nameEn: string; nameAr: string }) =>
    `${a.code ? `${a.code} ` : ''}${locale === 'ar' ? a.nameAr : a.nameEn}`;
  const stores: NamedStore[] = [];
  for (const r of data.stock.rows)
    if (!stores.some((s) => s.id === r.store.id)) stores.push(r.store);
  // Start on a store that holds packaging, if any.
  const [storeId, setStoreId] = useState(
    data.stock.rows.find((r) => r.onHand > 0)?.store.id ?? stores[0]?.id ?? '',
  );
  const active = data.items.filter((i) => i.isActive);
  const rows = data.stock.rows.filter((r) => r.store.id === storeId);
  const storeName = (id: string | null) => {
    const s = stores.find((x) => x.id === id);
    return s ? name(s) : t('everyStore');
  };

  return (
    <div className="mt-4 space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('store')}>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {name(s)}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-body-sm">
            {t('totalValue')}:{' '}
            <span className="font-bold">{formatEgp(data.stock.totalValuePiastres)}</span>
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noItems')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('item')}</th>
                  <th className={`${th} text-end`}>{t('onHand')}</th>
                  <th className={`${th} text-end`}>{t('averageCost')}</th>
                  <th className={`${th} text-end`}>{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item.id} className="border-t border-line">
                    <td className={td}>
                      {name(r.item)}
                      {r.low && (
                        <span className="ms-2 rounded-full bg-status-needs-action/15 px-2 py-0.5 text-caption font-bold text-status-needs-action">
                          {t('low', { limit: r.limit })}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-end`}>
                      {r.onHand} {r.item.unit}
                    </td>
                    <td className={`${td} text-end`}>
                      {r.averageCostPiastres === null ? '' : formatEgp(r.averageCostPiastres)}
                    </td>
                    <td className={`${td} text-end`}>{formatEgp(r.valuePiastres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.money && active.length > 0 && (
          <BuyForm storeId={storeId} items={active} money={data.money} name={name} />
        )}
        {data.canCount && active.length > 0 && (
          <CountForm storeId={storeId} items={active} name={name} canAdjust={data.canManage} />
        )}
      </div>

      <Card title={t('recipes')} hint={t('recipesHint')}>
        {data.recipes.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noRecipes')}</p>
        ) : (
          <ul className="divide-y divide-line text-body-sm">
            {data.recipes.map((r) => (
              <li key={`${r.darkStoreId}:${r.merchantId}`} className="py-2">
                <span className="font-bold">
                  {storeName(r.darkStoreId)} ·{' '}
                  {data.merchants.find((m) => m.id === r.merchantId)?.name ?? t('everyMerchant')}
                </span>
                <span className="block text-text-muted">
                  {r.lines.map((l) => `${l.quantity} × ${name(l)}`).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.canManage && active.length > 0 && (
          <RecipeForm stores={stores} items={active} merchants={data.merchants} name={name} />
        )}
      </Card>

      <Card title={t('items')}>
        <ul className="divide-y divide-line text-body-sm">
          {data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <span className="font-bold">{name(i)}</span>
                {i.isBox && <span className="ms-2 text-caption text-text-muted">{t('box')}</span>}
                {!i.isActive && (
                  <span className="ms-2 text-caption text-danger">{t('inactive')}</span>
                )}
              </span>
              <span className="text-text-muted">
                {t('unitCost')}: {formatEgp(i.unitCostPiastres)}
              </span>
            </li>
          ))}
        </ul>
        {data.canManage && <ItemForm />}
      </Card>

      <Card title={t('movements')}>
        {data.movements.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noMovements')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('when')}</th>
                  <th className={th}>{t('store')}</th>
                  <th className={th}>{t('item')}</th>
                  <th className={th}>{t('type')}</th>
                  <th className={`${th} text-end`}>{t('quantity')}</th>
                  <th className={`${th} text-end`}>{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className={`${td} ltr-iso whitespace-nowrap`}>
                      {formatCairoDateTime(m.createdAt, locale)}
                    </td>
                    <td className={td}>{storeName(m.darkStoreId)}</td>
                    <td className={td}>{name(m.item)}</td>
                    <td className={td}>
                      {t(`types.${m.type}`)}
                      {m.reason && (
                        <span className="block text-caption text-text-muted">{m.reason}</span>
                      )}
                    </td>
                    <td className={`${td} text-end`} dir="ltr">
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className={`${td} text-end`}>{formatEgp(m.valuePiastres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

type Namer = (a: { code?: string; nameEn: string; nameAr: string }) => string;

function BuyForm({
  storeId,
  items,
  money,
  name,
}: {
  storeId: string;
  items: PackagingItem[];
  money: { id: string; code: string; nameEn: string; nameAr: string }[];
  name: Namer;
}) {
  const t = useTranslations('purchasing.packaging');
  const action = useAction();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const qty = /^\d+$/.test(quantity.trim()) ? Number(quantity) : 0;
  const value = parseEgp(amount);
  return (
    <Card title={t('buy')} hint={t('buyHint')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('item')}>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {name(i)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('quantity')}>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className={`${field} text-end`}
          />
        </Field>
        <Field label={t('amountPaid')}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            className={`${field} text-end`}
          />
        </Field>
        <Field label={t('paidFrom')}>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
            {money.map((m) => (
              <option key={m.id} value={m.id}>
                {name(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('reference')}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={field}
          />
        </Field>
        <Field label={t('receipt')}>
          <ReceiptField onChange={setPhoto} />
        </Field>
      </div>
      <button
        type="button"
        className={primary}
        disabled={action.busy || !storeId || !qty || !value || reference.trim().length < 2}
        onClick={() =>
          void action
            .send(
              'POST',
              `/packaging/stores/${storeId}/purchases`,
              {
                itemId,
                quantity: qty,
                amountPiastres: value,
                moneyAccountId: from,
                reference: reference.trim(),
                ...(photo ? { receiptPhotoId: photo } : {}),
                idempotencyKey: newActionKey(),
              },
              t('bought'),
            )
            .then((ok) => {
              if (ok) {
                setQuantity('');
                setAmount('');
                setReference('');
              }
            })
        }
      >
        {t('buyButton')}
      </button>
      {action.view}
    </Card>
  );
}

function CountForm({
  storeId,
  items,
  name,
  canAdjust,
}: {
  storeId: string;
  items: PackagingItem[];
  name: Namer;
  canAdjust: boolean;
}) {
  const t = useTranslations('purchasing.packaging');
  const action = useAction();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [mode, setMode] = useState<'count' | 'adjust'>('count');
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const parsed = /^-?\d+$/.test(number.trim()) ? Number(number) : null;
  const ok =
    parsed !== null && (mode === 'count' ? parsed >= 0 : parsed !== 0 && reason.trim().length >= 3);
  return (
    <Card title={t('countTitle')} hint={t('countHint')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('item')}>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {name(i)}
              </option>
            ))}
          </select>
        </Field>
        {canAdjust && (
          <Field label={t('what')}>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'count' | 'adjust')}
              className={field}
            >
              <option value="count">{t('counted')}</option>
              <option value="adjust">{t('adjust')}</option>
            </select>
          </Field>
        )}
        <Field label={mode === 'count' ? t('countedUnits') : t('change')}>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            placeholder={mode === 'count' ? '0' : '-3'}
            className={`${field} text-end`}
          />
        </Field>
        {mode === 'adjust' && (
          <Field label={t('reason')}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
          </Field>
        )}
      </div>
      <button
        type="button"
        className={primary}
        disabled={action.busy || !storeId || !ok}
        onClick={() =>
          void action
            .send(
              'POST',
              `/packaging/stores/${storeId}/${mode}`,
              mode === 'count'
                ? { itemId, counted: parsed, idempotencyKey: newActionKey() }
                : {
                    itemId,
                    quantity: parsed,
                    reason: reason.trim(),
                    idempotencyKey: newActionKey(),
                  },
              t('saved'),
            )
            .then((done) => {
              if (done) {
                setNumber('');
                setReason('');
              }
            })
        }
      >
        {t('save')}
      </button>
      {action.view}
    </Card>
  );
}

function RecipeForm({
  stores,
  items,
  merchants,
  name,
}: {
  stores: NamedStore[];
  items: PackagingItem[];
  merchants: { id: string; name: string }[];
  name: Namer;
}) {
  const t = useTranslations('purchasing.packaging');
  const action = useAction();
  const [storeId, setStoreId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const lines = Object.entries(quantities)
    .filter(([, v]) => /^\d+$/.test(v.trim()) && Number(v) > 0)
    .map(([itemId, v]) => ({ itemId, quantity: Number(v) }));
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('store')}>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
            <option value="">{t('everyStore')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('merchant')}>
          <select
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className={field}
          >
            <option value="">{t('everyMerchant')}</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <Field key={i.id} label={name(i)}>
            <input
              value={quantities[i.id] ?? ''}
              onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))}
              inputMode="numeric"
              dir="ltr"
              placeholder="0"
              className={`${field} text-end`}
            />
          </Field>
        ))}
      </div>
      <button
        type="button"
        className={primary}
        disabled={action.busy}
        onClick={() =>
          void action.send(
            'PUT',
            '/packaging/recipes',
            { darkStoreId: storeId || null, merchantId: merchantId || null, lines },
            lines.length ? t('recipeSaved') : t('recipeRemoved'),
          )
        }
      >
        {t('saveRecipe')}
      </button>
      {action.view}
    </div>
  );
}

function ItemForm() {
  const t = useTranslations('purchasing.packaging');
  const action = useAction();
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [unit, setUnit] = useState('');
  const [cost, setCost] = useState('');
  const [isBox, setIsBox] = useState(false);
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="font-bold">{t('newItem')}</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={t('code')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('nameEn')}>
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label={t('nameAr')}>
          <input
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            dir="rtl"
            className={field}
          />
        </Field>
        <Field label={t('unit')}>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} className={field} />
        </Field>
        <Field label={t('unitCost')}>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            className={`${field} text-end`}
          />
        </Field>
        <label className="flex items-center gap-2 self-end text-body-sm">
          <input type="checkbox" checked={isBox} onChange={(e) => setIsBox(e.target.checked)} />
          {t('isBox')}
        </label>
      </div>
      <button
        type="button"
        className={primary}
        disabled={
          action.busy ||
          code.trim().length < 2 ||
          nameEn.trim().length < 2 ||
          nameAr.trim().length < 2
        }
        onClick={() =>
          void action
            .send(
              'POST',
              '/packaging/items',
              {
                code: code.trim(),
                nameEn: nameEn.trim(),
                nameAr: nameAr.trim(),
                ...(unit.trim() ? { unit: unit.trim() } : {}),
                unitCostPiastres: parseEgp(cost) ?? 0,
                isBox,
              },
              t('itemSaved'),
            )
            .then((ok) => {
              if (ok) {
                setCode('');
                setNameEn('');
                setNameAr('');
                setUnit('');
                setCost('');
                setIsBox(false);
              }
            })
        }
      >
        {t('addItem')}
      </button>
      {action.view}
    </div>
  );
}
