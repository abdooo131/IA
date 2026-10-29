export type Segment = 'new' | 'vip' | 'loyal' | 'one_time' | 'at_risk' | 'lost' | 'no_orders';
export const SEGMENTS: Segment[] = [
  'vip',
  'loyal',
  'new',
  'one_time',
  'at_risk',
  'lost',
  'no_orders',
];

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  governorate: string | null;
  city: string | null;
  orders: number;
  spendPiastres: number;
  merchants: number;
  lastOrderAt: string | null;
  segment: Segment;
};

export type CustomerList = { page: number; more: boolean; customers: CustomerRow[] };

export type CustomersOverview = {
  rules: { newDays: number; atRiskDays: number; lostDays: number; vipOrders: number };
  customers: number;
  withPhone: number;
  withEmail: number;
  buyers: number;
  repeatPct: number;
  multiMerchantPct: number;
  averageOrders: number;
  averageSpendPiastres: number;
  segments: { segment: Segment; customers: number; spendPiastres: number }[];
  governorates: { governorate: string | null; customers: number; spendPiastres: number }[];
  sharedShoppers: {
    a: { id: string; name: string };
    b: { id: string; name: string };
    customers: number;
  }[];
  newByMonth: { month: string; customers: number }[];
};

export type CustomerProfile = {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    governorate: string | null;
    city: string | null;
    address: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  segment: Segment;
  totals: {
    orders: number;
    cancelled: number;
    spendPiastres: number;
    averageOrderPiastres: number;
    units: number;
    merchants: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    everyDays: number | null;
  };
  merchants: {
    id: string;
    name: string;
    orders: number;
    spendPiastres: number;
    lastOrderAt: string | null;
  }[];
  categories: { category: string; units: number; spendPiastres: number }[];
  products: {
    title: string;
    imageUrl: string | null;
    merchant: string;
    units: number;
    spendPiastres: number;
    lastAt: string;
  }[];
  timing: { dow: number; hour: number; orders: number }[];
  payments: { method: string; orders: number }[];
  deliveries: {
    orders: number;
    delivered: number;
    failed: number;
    cancelled: number;
    codPiastres: number;
    averageStars: number | null;
  };
  shopRecords: {
    merchant: string;
    name: string;
    email: string | null;
    phone: string | null;
    ordersCount: number;
    amountSpentPiastres: number;
    emailMarketing: string | null;
    smsMarketing: string | null;
    tags: string[];
    since: string | null;
  }[];
  recentOrders: {
    source: 'shopify' | 'shiply';
    ref: string;
    recordId: string;
    merchant: string;
    at: string;
    valuePiastres: number;
    status: string;
    units: number;
  }[];
};
