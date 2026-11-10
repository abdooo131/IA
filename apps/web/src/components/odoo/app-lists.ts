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
  | 'customers/customers'
  | 'sales/deals'
  | 'sales/companies'
  | 'sales/proposals'
  | 'hr/employees'
  | 'hr/leave'
  | 'hr/violations'
  | 'hr/suggestions';

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
  // UX phase C step 4: Sales and HR.
  'sales/deals': () => [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'company', kind: 'text' },
    { key: 'title', kind: 'text', optional: true },
    { key: 'contact', kind: 'text', optional: true },
    { key: 'phone', kind: 'ltr', optional: true },
    { key: 'email', kind: 'ltr', optional: true },
    { key: 'stage', kind: 'status' },
    { key: 'owner', kind: 'text' },
    { key: 'source', kind: 'text', optional: true },
    { key: 'nextStep', kind: 'text' },
    { key: 'nextStepAt', kind: 'datetime' },
    { key: 'proposal', kind: 'text', optional: true },
    { key: 'stageChangedAt', kind: 'datetime', sort: 'stageChanged', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created', optional: true },
    { key: 'closeDate', kind: 'date', sort: 'closeDate', optional: true },
    { key: 'merchant', kind: 'text', optional: true },
    { key: 'expectedOrders', kind: 'number', sort: 'expectedOrders' },
    { key: 'expectedFee', kind: 'money', sort: 'expectedFee' },
  ],
  'sales/companies': () => [
    { key: 'name', kind: 'text', sort: 'name', primary: true },
    { key: 'source', kind: 'text' },
    { key: 'owner', kind: 'text' },
    { key: 'contact', kind: 'text', optional: true },
    { key: 'phone', kind: 'ltr', optional: true },
    { key: 'email', kind: 'ltr', optional: true },
    { key: 'city', kind: 'text', optional: true },
    { key: 'category', kind: 'text', optional: true },
    { key: 'website', kind: 'ltr', optional: true },
    { key: 'merchant', kind: 'text' },
    { key: 'contacts', kind: 'number', optional: true },
    { key: 'openDeals', kind: 'number', sort: 'openDeals' },
    { key: 'wonDeals', kind: 'number', sort: 'wonDeals' },
    { key: 'createdAt', kind: 'datetime', sort: 'created', optional: true },
  ],
  'sales/proposals': () => [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'deal', kind: 'ltr' },
    { key: 'company', kind: 'text' },
    { key: 'version', kind: 'number', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'owner', kind: 'text' },
    { key: 'discount', kind: 'number', sort: 'discount', format: 'percentBp' },
    { key: 'toApprove', kind: 'bool' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'sentAt', kind: 'datetime', optional: true },
    { key: 'validUntil', kind: 'date', optional: true },
    { key: 'acceptedAt', kind: 'datetime', optional: true },
    { key: 'confirmed', kind: 'bool', optional: true },
    { key: 'expectedOrders', kind: 'number', optional: true },
  ],
  'hr/employees': (locale) => [
    { key: locale === 'ar' ? 'nameAr' : 'nameEn', kind: 'text', sort: 'name', primary: true },
    { key: 'code', kind: 'ltr', sort: 'code' },
    { key: locale === 'ar' ? 'positionAr' : 'position', kind: 'text' },
    { key: locale === 'ar' ? 'departmentAr' : 'department', kind: 'text', sort: 'department' },
    { key: 'store', kind: 'ltr', sort: 'store' },
    { key: 'mobile', kind: 'ltr', optional: true },
    { key: 'email', kind: 'ltr', optional: true },
    { key: 'manager', kind: 'text', optional: true },
    { key: 'employment', kind: 'text' },
    { key: 'payBasis', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'flags', kind: 'text', format: 'employeeFlags' },
    { key: 'hireDate', kind: 'date', sort: 'hired', optional: true },
    { key: 'probationEndsOn', kind: 'date', optional: true },
    { key: 'documents', kind: 'number', sort: 'documents', format: 'percent' },
  ],
  'hr/leave': (locale) => [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: locale === 'ar' ? 'employeeAr' : 'employee', kind: 'text' },
    { key: 'employeeCode', kind: 'ltr', optional: true },
    { key: locale === 'ar' ? 'typeAr' : 'type', kind: 'text' },
    { key: 'from', kind: 'date', sort: 'from' },
    { key: 'to', kind: 'date' },
    { key: 'days', kind: 'number', sort: 'days' },
    { key: 'store', kind: 'ltr', optional: true },
    { key: 'department', kind: 'text', optional: true },
    { key: 'waitingForMe', kind: 'bool' },
    { key: 'hasDocument', kind: 'bool', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created', optional: true },
    { key: 'status', kind: 'status' },
  ],
  'hr/violations': (locale) => [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: locale === 'ar' ? 'employeeAr' : 'employee', kind: 'text' },
    { key: 'employeeCode', kind: 'ltr', optional: true },
    { key: locale === 'ar' ? 'typeAr' : 'type', kind: 'text' },
    { key: 'occurredOn', kind: 'date', sort: 'occurred' },
    { key: 'step', kind: 'number' },
    { key: 'penalty', kind: 'text' },
    { key: 'days', kind: 'number', optional: true },
    { key: 'store', kind: 'ltr', optional: true },
    { key: 'employment', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  'hr/suggestions': (locale) => [
    { key: locale === 'ar' ? 'employeeAr' : 'employee', kind: 'text', primary: true },
    { key: 'employeeCode', kind: 'ltr' },
    { key: 'day', kind: 'date', sort: 'day' },
    { key: 'kind', kind: 'text' },
    { key: 'lateMinutes', kind: 'number', sort: 'lateMinutes' },
    { key: locale === 'ar' ? 'typeAr' : 'type', kind: 'text' },
    { key: 'store', kind: 'ltr', optional: true },
    { key: 'violation', kind: 'ltr' },
    { key: 'status', kind: 'status' },
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
  'sales/deals': '/admin/sales/deals/{id}',
  'sales/companies': '/admin/sales/companies/{id}',
  'sales/proposals': '/admin/sales/deals/{dealId}',
  'hr/employees': '/admin/hr/{id}',
  'hr/leave': '/admin/hr/leave/{id}',
  'hr/violations': '/admin/hr/violations/{id}',
  // A suggestion opens the person's attendance, where the day can be checked.
  'hr/suggestions': '/admin/hr/{employeeId}',
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
  /** A list's own word table (appLists.<list>.<group>) as value → label. */
  const own = (group: string): Record<string, string> =>
    t.has(`${id}.${group}`) ? (t.raw(`${id}.${group}`) as Record<string, string>) : {};
  /** English names (rows and groups carry them) → Arabic names, from the options. */
  const arabicNames = (list: Option[] | undefined) =>
    Object.fromEntries((list ?? []).map((o) => [o.label, o.labelAr ?? o.label]));
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
    // UX phase C step 4: Sales and HR name their values in their own words.
    case 'sales/deals':
      valueLabels.stage = own('stages');
      valueLabels.source = own('sources');
      valueLabels.proposal = own('proposalStatuses');
      break;
    case 'sales/companies':
      valueLabels.source = own('sources');
      break;
    case 'sales/proposals':
      valueLabels.status = own('statuses');
      break;
    case 'hr/employees':
      valueLabels.status = own('statuses');
      valueLabels.employment = own('employments');
      valueLabels.payBasis = own('payBases');
      if (locale === 'ar') {
        valueLabels.department = arabicNames(options.department);
        valueLabels.position = arabicNames(options.position);
      }
      break;
    case 'hr/leave':
      valueLabels.status = own('statuses');
      if (locale === 'ar') {
        valueLabels.type = arabicNames(options.type);
        valueLabels.department = arabicNames(options.department);
      }
      break;
    case 'hr/violations':
      valueLabels.status = own('statuses');
      valueLabels.penalty = own('penalties');
      valueLabels.employment = own('employments');
      if (locale === 'ar') valueLabels.type = arabicNames(options.type);
      break;
    case 'hr/suggestions':
      valueLabels.status = own('statuses');
      valueLabels.kind = own('kinds');
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

  if (key === 'sales/deals' && canDo(profile, 'sales', 'use')) {
    if (canDo(profile, 'sales', 'manage'))
      bulk.push({
        key: 'assign',
        label: t('bulk.assignDeals'),
        endpoint: '/sales/deals/bulk-assign',
        choice: {
          field: 'ownerId',
          label: t('bulk.assignTo'),
          options: [
            ...(options.owner ?? []).map((o) => ({ value: o.value, label: o.label })),
            { value: 'none', label: t('bulk.backToQueue') },
          ],
        },
      });
    const stages = own('stages');
    bulk.push(
      {
        key: 'stage',
        label: t('bulk.moveDeals'),
        endpoint: '/sales/deals/bulk-stage',
        choice: {
          field: 'stage',
          label: t('bulk.moveTo'),
          options: ['new', 'contacted', 'meeting', 'proposal', 'negotiation'].map((v) => ({
            value: v,
            label: stages[v] ?? v,
          })),
        },
      },
      {
        key: 'lost',
        label: t('bulk.markLost'),
        endpoint: '/sales/deals/bulk-lost',
        note: 'required',
        tone: 'danger',
      },
    );
  }
  if (key === 'hr/leave' && canDo(profile, 'hr', 'use'))
    bulk.push(
      {
        key: 'approve',
        label: t('bulk.approveLeave'),
        endpoint: '/hr/leave/requests/bulk-approve',
      },
      {
        key: 'reject',
        label: t('bulk.rejectLeave'),
        endpoint: '/hr/leave/requests/bulk-reject',
        note: 'required',
        tone: 'danger',
      },
    );
  if (key === 'hr/suggestions' && canDo(profile, 'hr', 'use'))
    bulk.push(
      {
        key: 'confirm',
        label: t('bulk.confirmSuggestions'),
        endpoint: '/hr/violations/suggestions/bulk-confirm',
      },
      {
        key: 'dismiss',
        label: t('bulk.dismissSuggestions'),
        endpoint: '/hr/violations/suggestions/bulk-dismiss',
        tone: 'danger',
      },
    );

  return {
    listId: `${app}_${id}`,
    endpoint: `/lists/${key}`,
    columns: COLUMNS[key](locale).map((c) => ({
      ...c,
      label: label(
        'columns',
        c.key
          .replace(/^title(En|Ar)$/, 'title')
          .replace(/^name(En|Ar)$/, 'name')
          .replace(/^(employee|type|department|position)Ar$/, '$1'),
      ),
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
    ...(key === 'sales/proposals' && { navIdKey: 'dealId' }),
    ...(key === 'hr/suggestions' && { navIdKey: 'employeeId' }),
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
