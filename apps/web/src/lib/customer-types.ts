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
  /** When a repeat customer would usually order again */
  expectedAt: string | null;
};

export type CustomerList = { page: number; more: boolean; customers: CustomerRow[] };

export type RiskLevel = 'unknown' | 'low' | 'medium' | 'high';
export type Risk = {
  level: RiskLevel;
  pct: number;
  attempts: number;
  failed: number;
  refused: number;
  noAnswer: number;
  cashShort: number;
};

export type CustomersOverview = {
  rules: {
    newDays: number;
    atRiskDays: number;
    lostDays: number;
    vipOrders: number;
    latePct: number;
    atRiskValuePct: number;
    budgetPct: number;
    premiumPct: number;
    riskMinAttempts: number;
  };
  forecastPiastres: number;
  dueToReorder: number;
  emailSubscribers: number;
  smsSubscribers: number;
  timing: { dow: number; hour: number; orders: number }[];
  storePeaks: {
    id: string;
    nameEn: string;
    nameAr: string;
    orders: number;
    hours: { hour: number; orders: number }[];
  }[];
  categoryPairs: { a: string; b: string; customers: number; lift: number }[];
  riskyCustomers: {
    id: string;
    name: string;
    phone: string | null;
    attempts: number;
    failed: number;
    refused: number;
    pct: number;
  }[];
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
  district: { id: string; nameEn: string; nameAr: string } | null;
  household: { id: string; name: string; phone: string | null }[];
  aliases: { kind: 'phone' | 'email'; value: string }[];
  risk: Risk;
  value: {
    spend30Piastres: number;
    spend90Piastres: number;
    spend365Piastres: number;
    monthly: { month: string; spendPiastres: number; orders: number }[];
    expectedAt: string | null;
    due: boolean;
    forecastPiastres: number;
    priceIndex: number | null;
    priceTier: 'budget' | 'mid' | 'premium' | null;
  };
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

export type DistrictDemand = {
  placed: number;
  unplaced: number;
  spendOutsidePiastres: number;
  districts: {
    id: string;
    nameEn: string;
    nameAr: string;
    governorateEn: string | null;
    governorateAr: string | null;
    customers: number;
    buyers: number;
    orders: number;
    spendPiastres: number;
    coveredPct: number;
  }[];
};

export type CrossSell = {
  customers: number;
  alsoBuyElsewhere: number;
  gaps: { category: string; customers: number; spendPiastres: number; merchants: number }[];
};
