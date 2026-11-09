import 'server-only';
import { appListMeta, canDo, type ListMeta } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BulkAction, ListColumn, ListData, ListViewConfig } from '@/lib/list-view';
import { ORDER_STATUS_LIST } from '@/lib/order-types';

// The list views of the other apps (UX phase C; APP_LISTS in packages/shared): their columns,
// value filter choices, bulk actions and row pages, every label in the reader's language. The
// keys come from APP_LISTS, the same keys the API implements (GET /lists/<app>/<id>).

type Col = Omit<ListColumn, 'label'>;
export type AppListKey = 'operations/orders' | 'operations/alerts' | 'inventory/damage';

const COLUMNS: Record<AppListKey, (locale: string) => Col[]> = {
  'operations/orders': () => [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'placedAt', kind: 'datetime', sort: 'placed' },
    { key: 'store', kind: 'text' },
    { key: 'merchant', kind: 'text' },
    { key: 'customer', kind: 'text' },
    { key: 'phone', kind: 'ltr', optional: true },
    { key: 'address', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'lateStage', kind: 'text' },
    { key: 'promiseAt', kind: 'datetime', sort: 'promise', optional: true },
    { key: 'payment', kind: 'text' },
    { key: 'source', kind: 'text', optional: true },
    { key: 'rider', kind: 'text', optional: true },
    { key: 'units', kind: 'number', optional: true },
    { key: 'value', kind: 'money', sort: 'value' },
    { key: 'cod', kind: 'money', sort: 'cod' },
    { key: 'deliveryFee', kind: 'money', optional: true },
  ],
  'operations/alerts': () => [
    { key: 'message', kind: 'text', format: 'alert', primary: true },
    { key: 'type', kind: 'text', sort: 'type', optional: true },
    { key: 'orderNumber', kind: 'ltr' },
    { key: 'store', kind: 'text' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'status', kind: 'status' },
    { key: 'resolvedBy', kind: 'text', optional: true },
    { key: 'resolvedAt', kind: 'datetime', optional: true },
  ],
  'inventory/damage': (locale) => [
    { key: 'sku', kind: 'ltr', primary: true },
    { key: locale === 'ar' ? 'titleAr' : 'titleEn', kind: 'text' },
    { key: 'quantity', kind: 'number', sort: 'quantity' },
    { key: 'cause', kind: 'text' },
    { key: 'store', kind: 'text' },
    { key: 'merchant', kind: 'text' },
    { key: 'rider', kind: 'text', optional: true },
    { key: 'reportedBy', kind: 'text', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'settledBy', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'value', kind: 'money', sort: 'value' },
    { key: 'compensation', kind: 'money', optional: true },
    { key: 'riderCharge', kind: 'money', optional: true },
  ],
};

const HREFS: Record<AppListKey, string | undefined> = {
  'operations/orders': '/admin/orders/{id}',
  'operations/alerts': '/admin/orders/{orderId}',
  'inventory/damage': '/admin/damage/{id}',
};

type Option = { value: string; label: string; labelAr?: string };

/** The list view of one app list, labelled in the reader's language. */
export async function appListConfig(key: AppListKey): Promise<ListViewConfig> {
  const [app, id] = key.split('/') as [string, string];
  const meta: ListMeta = appListMeta(app, id)!;
  const [t, statuses, stages, damage, alerts, locale, profile, options] = await Promise.all([
    getTranslations('appLists'),
    getTranslations('orders.statuses'),
    getTranslations('orders.stages'),
    getTranslations('damage'),
    getTranslations('admin.alerts'),
    getLocale(),
    getMyProfile(),
    apiGet<Record<string, Option[]>>(`/lists/${key}/options`),
  ]);
  const label = (group: string, k: string) =>
    t.has(`${id}.${group}.${k}`) ? t(`${id}.${group}.${k}`) : t(`${group}.${k}`);
  const optionLabel = (o: Option) => (locale === 'ar' && o.labelAr ? o.labelAr : o.label);
  const typeName = (type: string) =>
    alerts.has(`typeNames.${type}`) ? alerts(`typeNames.${type}`) : type;

  const valueLabels: Record<string, Record<string, string>> = {};
  // Stores show as their code in rows and groups; the label adds their name.
  const stores = options.store ?? [];
  valueLabels.store = Object.fromEntries(
    stores.map((s) => [optionLabel(s).split(' · ')[0]!, optionLabel(s)]),
  );
  switch (key) {
    case 'operations/orders':
      valueLabels.status = Object.fromEntries(ORDER_STATUS_LIST.map((s) => [s, statuses(s)]));
      valueLabels.lateStage = Object.fromEntries(
        ['accept', 'pick', 'pack', 'handover', 'ride'].map((s) => [
          s,
          stages.has(s) ? stages(s) : s,
        ]),
      );
      valueLabels.payment = { cod: t('payment.cod'), prepaid: t('payment.prepaid') };
      valueLabels.source = { shopify: t('source.shopify'), manual: t('source.manual') };
      break;
    case 'operations/alerts':
      valueLabels.type = Object.fromEntries(
        (options.type ?? []).map((o) => [o.value, typeName(o.value)]),
      );
      valueLabels.status = { open: t('alerts.status.open'), handled: t('alerts.status.handled') };
      break;
    case 'inventory/damage':
      valueLabels.cause = Object.fromEntries(
        ['arrived_damaged', 'store_handling', 'delivery', 'customer', 'expired'].map((c) => [
          c,
          damage(`causes.${c}`),
        ]),
      );
      valueLabels.status = {
        pending: damage('statuses.pending'),
        settled: damage('statuses.settled'),
      };
      break;
  }

  const bulk: BulkAction[] = [];
  if (key === 'operations/orders' && canDo(profile, 'operations', 'use'))
    bulk.push(
      { key: 'accept', label: t('bulk.accept'), endpoint: '/admin/orders/bulk-accept' },
      {
        key: 'cancel',
        label: t('bulk.cancel'),
        endpoint: '/admin/orders/bulk-cancel',
        note: 'required',
        tone: 'danger',
      },
    );
  if (key === 'operations/alerts' && canDo(profile, 'operations', 'use'))
    bulk.push({ key: 'resolve', label: t('bulk.resolve'), endpoint: '/admin/alerts/bulk-resolve' });

  return {
    listId: `${app}_${id}`,
    endpoint: `/lists/${key}`,
    columns: COLUMNS[key](locale).map((c) => ({
      ...c,
      label: label('columns', c.key.replace(/^title(En|Ar)$/, 'title')),
    })),
    filters: Object.entries(meta.filters).map(([k, group]) => ({
      key: k,
      group,
      label:
        group === 'status' && key === 'operations/orders' && k !== 'active'
          ? statuses(k)
          : group === 'cause'
            ? damage(`causes.${k}`)
            : label('filters', k),
    })),
    values: Object.entries(meta.values ?? {}).map(([k, kind]) => ({
      key: k,
      kind,
      label: label('values', k),
      ...(kind === 'option' && {
        options: (options[k] ?? []).map((o) => ({
          value: o.value,
          label: k === 'type' ? typeName(o.value) : optionLabel(o),
        })),
      }),
    })),
    groupBys: meta.groupBys.map((k) => ({ key: k, label: label('groups', k) })),
    valueLabels,
    rowHref: HREFS[key],
    ...(key === 'operations/alerts' && { navIdKey: 'orderId' }),
    bulkActions: bulk.length ? bulk : undefined,
    defaultFilters: [...meta.defaultFilters],
    exportName: t(`${id}.exportName`),
  };
}

/** The rows of an app list for the address the page was opened with. */
export function appListData(
  key: AppListKey,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const k of ['q', 'f', 'g', 'sort', 'desc', 'page', 'size', 'v']) {
    const v = searchParams[k];
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined) query.set(k, value);
  }
  return apiGet<ListData>(`/lists/${key}?${query}`);
}
