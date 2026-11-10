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
export type AppListKey =
  | 'operations/orders'
  | 'operations/alerts'
  | 'inventory/stock'
  | 'inventory/shipments'
  | 'inventory/transfers'
  | 'inventory/returns'
  | 'inventory/counts'
  | 'inventory/damage'
  | 'merchants/merchants'
  | 'merchants/products'
  | 'customers/customers';

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
  'inventory/stock': (locale) => [
    { key: 'sku', kind: 'ltr', sort: 'sku', primary: true },
    { key: locale === 'ar' ? 'titleAr' : 'titleEn', kind: 'text' },
    { key: 'barcode', kind: 'ltr', optional: true },
    { key: 'store', kind: 'text' },
    { key: 'merchant', kind: 'text' },
    // Available first, so a phone card shows it.
    { key: 'available', kind: 'number', sort: 'available' },
    { key: 'onHand', kind: 'number', sort: 'onHand' },
    { key: 'reserved', kind: 'number', sort: 'reserved' },
    { key: 'level', kind: 'status' },
  ],
  'inventory/shipments': () => [
    { key: 'reference', kind: 'ltr', sort: 'reference', primary: true },
    { key: 'merchant', kind: 'text' },
    { key: 'store', kind: 'text' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'expectedAt', kind: 'date', optional: true },
    { key: 'receivedAt', kind: 'datetime', optional: true },
    { key: 'lines', kind: 'number', optional: true },
    { key: 'expectedUnits', kind: 'number', sort: 'expectedUnits' },
    { key: 'receivedUnits', kind: 'number', sort: 'receivedUnits' },
    { key: 'extraUnits', kind: 'number', optional: true },
    { key: 'shortUnits', kind: 'number', optional: true },
    { key: 'status', kind: 'status' },
  ],
  'inventory/transfers': () => [
    { key: 'reference', kind: 'ltr', sort: 'reference', primary: true },
    { key: 'sender', kind: 'text' },
    { key: 'receiver', kind: 'text' },
    { key: 'destination', kind: 'text' },
    { key: 'origin', kind: 'text', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'sentAt', kind: 'datetime', optional: true },
    { key: 'receivedAt', kind: 'datetime', optional: true },
    { key: 'lines', kind: 'number', optional: true },
    { key: 'units', kind: 'number', sort: 'units' },
    { key: 'pickedUnits', kind: 'number' },
    { key: 'receivedUnits', kind: 'number' },
    { key: 'status', kind: 'status' },
  ],
  'inventory/returns': () => [
    { key: 'reference', kind: 'ltr', sort: 'reference', primary: true },
    { key: 'merchant', kind: 'text' },
    { key: 'store', kind: 'text' },
    { key: 'sources', kind: 'text', format: 'returnSources', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'collectedAt', kind: 'datetime', optional: true },
    { key: 'collectedBy', kind: 'text', optional: true },
    { key: 'units', kind: 'number', sort: 'units' },
    { key: 'pickedUnits', kind: 'number' },
    { key: 'status', kind: 'status' },
  ],
  'inventory/counts': () => [
    { key: 'bin', kind: 'ltr', primary: true },
    { key: 'store', kind: 'text' },
    { key: 'submittedBy', kind: 'text' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'lines', kind: 'number', optional: true },
    { key: 'expectedUnits', kind: 'number', optional: true },
    { key: 'countedUnits', kind: 'number', optional: true },
    { key: 'differences', kind: 'number', sort: 'differences' },
    { key: 'netDifference', kind: 'number' },
    { key: 'reviewedBy', kind: 'text', optional: true },
    { key: 'reviewedAt', kind: 'datetime', optional: true },
    { key: 'status', kind: 'status' },
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
  'merchants/merchants': () => [
    { key: 'name', kind: 'text', sort: 'name', primary: true },
    { key: 'state', kind: 'status' },
    { key: 'approval', kind: 'text' },
    { key: 'contactPhone', kind: 'ltr', optional: true },
    { key: 'contactEmail', kind: 'ltr', optional: true },
    { key: 'manager', kind: 'text' },
    { key: 'shopifyDomain', kind: 'ltr', optional: true },
    { key: 'contract', kind: 'ltr' },
    { key: 'schedule', kind: 'text', optional: true },
    { key: 'expressPrice', kind: 'money', optional: true },
    { key: 'skus', kind: 'number', sort: 'skus' },
    { key: 'orders30', kind: 'number', sort: 'orders30' },
    { key: 'balance', kind: 'money', sort: 'balance' },
    { key: 'createdAt', kind: 'datetime', sort: 'created', optional: true },
  ],
  'merchants/products': (locale) => [
    { key: 'sku', kind: 'ltr', sort: 'sku', primary: true },
    { key: locale === 'ar' ? 'titleAr' : 'titleEn', kind: 'text', sort: 'title' },
    { key: 'barcode', kind: 'ltr', optional: true },
    { key: 'merchant', kind: 'text' },
    { key: 'state', kind: 'status' },
    // Available first, so a phone card shows it.
    { key: 'available', kind: 'number', sort: 'available' },
    { key: 'onHand', kind: 'number', sort: 'onHand' },
    { key: 'reserved', kind: 'number', optional: true },
    { key: 'stores', kind: 'number', optional: true },
    { key: 'shopify', kind: 'text' },
    { key: 'weightGrams', kind: 'number', optional: true },
    { key: 'price', kind: 'money', sort: 'price' },
  ],
  'customers/customers': () => [
    { key: 'name', kind: 'text', sort: 'name', primary: true },
    { key: 'segment', kind: 'status' },
    { key: 'phone', kind: 'ltr' },
    { key: 'email', kind: 'ltr', optional: true },
    { key: 'district', kind: 'text' },
    { key: 'governorate', kind: 'text', optional: true },
    { key: 'mainMerchant', kind: 'text', optional: true },
    { key: 'risk', kind: 'text' },
    { key: 'orders', kind: 'number', sort: 'orders' },
    { key: 'merchants', kind: 'number', optional: true },
    { key: 'lastOrderAt', kind: 'datetime', sort: 'last' },
    { key: 'expectedAt', kind: 'datetime', optional: true },
    { key: 'spend', kind: 'money', sort: 'spend' },
  ],
};

const HREFS: Record<AppListKey, string | undefined> = {
  'operations/orders': '/admin/orders/{id}',
  'operations/alerts': '/admin/orders/{orderId}',
  'inventory/stock': '/admin/products/{skuId}',
  'inventory/shipments': '/admin/shipments/{id}',
  'inventory/transfers': '/admin/transfers/{id}',
  'inventory/returns': '/admin/returns/{id}',
  'inventory/counts': '/admin/counts/{id}',
  'inventory/damage': '/admin/damage/{id}',
  'merchants/merchants': '/admin/merchants/{id}',
  'merchants/products': '/admin/products/{id}',
  'customers/customers': '/admin/customers/{id}',
};

type Option = { value: string; label: string; labelAr?: string };

/** The list view of one app list, labelled in the reader's language. */
export async function appListConfig(key: AppListKey): Promise<ListViewConfig> {
  const [app, id] = key.split('/') as [string, string];
  const meta: ListMeta = appListMeta(app, id)!;
  const [
    t,
    statuses,
    stages,
    damage,
    alerts,
    shipmentStatuses,
    transfers,
    returns,
    counts,
    schedules,
    segments,
    risks,
    locale,
    profile,
    options,
  ] = await Promise.all([
    getTranslations('appLists'),
    getTranslations('orders.statuses'),
    getTranslations('orders.stages'),
    getTranslations('damage'),
    getTranslations('admin.alerts'),
    getTranslations('merchant.shipments.statuses'),
    getTranslations('transfers'),
    getTranslations('returns'),
    getTranslations('admin.counts'),
    getTranslations('finance.schedules'),
    getTranslations('customers.segments'),
    getTranslations('customers.riskLevels'),
    getLocale(),
    getMyProfile(),
    apiGet<Record<string, Option[]>>(`/lists/${key}/options`),
  ]);
  /** A document status in the words its own screens use. */
  const statusName: ((s: string) => string) | null =
    key === 'operations/orders'
      ? (s) => statuses(s)
      : key === 'inventory/shipments'
        ? (s) => shipmentStatuses(s)
        : key === 'inventory/transfers'
          ? (s) => transfers(`statuses.${s}`)
          : key === 'inventory/returns'
            ? (s) => returns(`statuses.${s}`)
            : key === 'inventory/counts'
              ? (s) => counts(`statuses.${s}`)
              : null;
  const label = (group: string, k: string) =>
    t.has(`${id}.${group}.${k}`) ? t(`${id}.${group}.${k}`) : t(`${group}.${k}`);
  const optionLabel = (o: Option) => (locale === 'ar' && o.labelAr ? o.labelAr : o.label);
  const typeName = (type: string) =>
    alerts.has(`typeNames.${type}`) ? alerts(`typeNames.${type}`) : type;

  const valueLabels: Record<string, Record<string, string>> = {};
  // Stores show as their code in rows and groups; the label adds their name.
  const stores = options.store ?? options.sender ?? [];
  const storeNames = Object.fromEntries(
    stores.map((s) => [optionLabel(s).split(' · ')[0]!, optionLabel(s)]),
  );
  valueLabels.store = storeNames;
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
    case 'inventory/stock':
      valueLabels.level = {
        out: t('stock.levels.out'),
        low: t('stock.levels.low'),
        ok: t('stock.levels.ok'),
      };
      break;
    case 'inventory/shipments':
    case 'inventory/returns':
    case 'inventory/counts':
      valueLabels.status = Object.fromEntries(
        Object.keys(meta.filters)
          .filter((k) => meta.filters[k] === 'status' && k !== 'open')
          .map((s) => [s, statusName!(s)]),
      );
      break;
    case 'inventory/transfers':
      valueLabels.status = Object.fromEntries(
        Object.keys(meta.filters)
          .filter((k) => meta.filters[k] === 'status' && k !== 'open')
          .map((s) => [s, statusName!(s)]),
      );
      valueLabels.sender = storeNames;
      valueLabels.receiver = storeNames;
      valueLabels.destination = storeNames;
      valueLabels.origin = { manual: t('origin.manual'), refill: t('origin.refill') };
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
    case 'merchants/merchants':
      valueLabels.approval = {
        pending: t('merchants.approval.pending'),
        approved: t('merchants.approval.approved'),
        rejected: t('merchants.approval.rejected'),
      };
      valueLabels.state = {
        active: t('merchants.state.active'),
        paused: t('merchants.state.paused'),
      };
      valueLabels.schedule = Object.fromEntries(
        ['daily', 'twice_weekly', 'weekly'].map((k) => [k, schedules(k)]),
      );
      break;
    case 'merchants/products':
      valueLabels.state = {
        active: t('products.state.active'),
        inactive: t('products.state.inactive'),
      };
      valueLabels.shopify = {
        linked: t('products.shopify.linked'),
        not_linked: t('products.shopify.not_linked'),
      };
      break;
    case 'customers/customers':
      valueLabels.segment = Object.fromEntries(
        Object.keys(meta.filters)
          .filter((k) => meta.filters[k] === 'segment')
          .map((s) => [s, segments(s)]),
      );
      valueLabels.risk = Object.fromEntries(
        ['high', 'medium', 'low', 'unknown'].map((r) => [r, risks(r)]),
      );
      // Districts show in the reader's language (rows carry the English name).
      if (locale === 'ar')
        valueLabels.district = Object.fromEntries(
          (options.district ?? []).map((o) => [o.label, o.labelAr ?? o.label]),
        );
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
  if (key === 'inventory/transfers' && canDo(profile, 'inventory', 'manage'))
    bulk.push({
      key: 'approve',
      label: t('bulk.approveTransfers'),
      endpoint: '/admin/transfers/bulk-approve',
    });
  if (key === 'inventory/counts' && canDo(profile, 'inventory', 'manage'))
    bulk.push({
      key: 'approve',
      label: t('bulk.approveCounts'),
      endpoint: '/admin/stock-counts/bulk-approve',
    });
  if (key === 'merchants/merchants' && canDo(profile, 'merchants', 'use')) {
    if (canDo(profile, 'merchants', 'manage'))
      bulk.push({
        key: 'approve',
        label: t('bulk.approveSignups'),
        endpoint: '/admin/merchants/bulk-approve',
      });
    bulk.push(
      { key: 'pause', label: t('bulk.pauseMerchants'), endpoint: '/admin/merchants/bulk-pause' },
      {
        key: 'activate',
        label: t('bulk.activateMerchants'),
        endpoint: '/admin/merchants/bulk-activate',
      },
    );
  }

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
        group === 'status' && statusName && k !== 'active' && k !== 'open'
          ? statusName(k)
          : group === 'cause'
            ? damage(`causes.${k}`)
            : group === 'segment'
              ? segments(k)
              : group === 'risk'
                ? risks(k.replace(/^risk_/, ''))
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
