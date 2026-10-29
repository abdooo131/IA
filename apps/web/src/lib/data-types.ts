export interface ProductInsight {
  id: string;
  title: string;
  status: string;
  category: string | null;
  imageUrl: string | null;
  units90: number;
  revenue90: number;
  revenueAll: number;
  stock: number;
  coverDays: number | null;
  lastSold: string | null;
}

export interface MerchantInsights {
  merchant: { id: string; name: string };
  shop: {
    domain: string;
    profile: {
      shop?: {
        name?: string;
        currencyCode?: string;
        createdAt?: string;
        plan?: { displayName?: string };
      };
    } | null;
    dataSyncedAt: string | null;
    syncs: {
      kind: string;
      status: string;
      objectCount: number;
      limited: string | null;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
    }[];
  } | null;
  catalogue: {
    products: number;
    active: number;
    draft: number;
    archived: number;
    variants: number;
    categories: number;
  };
  stock: { ownWarehouses: number; inOurStores: number; warehouses: number; valuePiastres: number };
  sales: {
    orders: number;
    revenuePiastres: number;
    units: number;
    averageOrderPiastres: number;
    discountRateBp: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    orders30: number;
    revenue30Piastres: number;
  };
  monthly: { month: string; orders: number; revenuePiastres: number; units: number }[];
  abc: { A: number; B: number; C: number };
  topProducts: ProductInsight[];
  runningOut: ProductInsight[];
  deadStock: ProductInsight[];
  categories: { category: string; products: number; revenue90Piastres: number; units90: number }[];
  regions: { province: string; orders: number; revenuePiastres: number }[];
  channels: { source: string; orders: number; revenuePiastres: number }[];
}

export interface MarketInsights {
  categories: {
    category: string;
    merchants: number;
    products: number;
    revenue90Piastres: number;
    sharePct: number;
    growthPct: number | null;
    units90: number;
    averageLinePiastres: number;
    orders90: number;
  }[];
  monthly: { month: string; orders: number; revenuePiastres: number; merchants: number }[];
  regions: { province: string; orders: number; revenuePiastres: number; merchants: number }[];
  merchants: {
    id: string;
    name: string;
    orders90: number;
    revenue90Piastres: number;
    products: number;
    topCategory: string | null;
  }[];
}
