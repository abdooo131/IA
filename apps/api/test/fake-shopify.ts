import { ShopifyAdmin } from '../src/shopify/shopify-admin';

type Line = { id: string; sku: string; variantId: string; quantity: number; price: string };

export interface FakeFulfillmentOrder {
  id: string;
  orderId: string;
  name: string;
  locationId: string;
  assignment:
    'FULFILLMENT_REQUESTED' | 'FULFILLMENT_ACCEPTED' | 'CANCELLATION_REQUESTED' | 'CLOSED';
  lines: Line[];
  outstanding: string;
  shipping: string;
  address: {
    name: string;
    phone: string;
    address1: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  };
  rejected?: { reason: string; message: string };
  /** The shipping rate code the customer chose; by default our 60 minute rate from that store. */
  shippingCode?: string | null;
}

let seq = 1000;
const gid = (type: string) => `gid://shopify/${type}/${++seq}`;

/** An in-memory Shopify that answers the app's GraphQL operations, for tests. */
export class FakeShopify extends ShopifyAdmin {
  services: { id: string; name: string; callbackUrl: string; locationId: string }[] = [];
  variants: {
    id: string;
    sku: string | null;
    barcode: string | null;
    price: string;
    title: string;
    inventoryItemId: string;
    product: string;
  }[] = [];
  fulfillmentOrders: FakeFulfillmentOrder[] = [];
  /** inventoryItemId|locationId -> available */
  inventory = new Map<string, number>();
  idempotencyKeys: string[] = [];
  fulfillments: {
    id: string;
    fulfillmentOrderId: string;
    tracking: string;
    trackingUrl?: string;
    events: string[];
  }[] = [];
  orderQuantities = new Map<string, number>();
  carrierServices: { id: string; name: string; callbackUrl: string }[] = [];
  /** locationId -> address set through locationEdit */
  locationAddresses = new Map<
    string,
    { name: string; address1: string; address2: string; city: string; provinceCode: string }
  >();
  webhooks: { id: string; topic: string; uri: string }[] = [];
  calls: string[] = [];
  /** The merchant's store for data exports, as Shopify would export it (JSON Lines rows). */
  store = {
    products: [] as object[],
    inventory: [] as object[],
    orders: [] as object[],
    customers: [] as object[],
  };
  /** Refuse buyer contact details, like an app without protected customer data (level 2) */
  denyContact = false;
  /** Refuse order addresses too, like an app without protected customer data at all */
  denyAddresses = false;
  bulk: { id: string; query: string; polls: number; status?: string; errorCode?: string }[] = [];

  addVariant(sku: string | null, price = '100.00', barcode: string | null = null) {
    const v = {
      id: gid('ProductVariant'),
      sku,
      barcode,
      price,
      title: 'Default Title',
      inventoryItemId: gid('InventoryItem'),
      product: `Product ${sku}`,
    };
    this.variants.push(v);
    return v;
  }

  addRequest(input: Omit<FakeFulfillmentOrder, 'id' | 'orderId' | 'assignment'>) {
    const fo: FakeFulfillmentOrder = {
      ...input,
      id: gid('FulfillmentOrder'),
      orderId: gid('Order'),
      assignment: 'FULFILLMENT_REQUESTED',
    };
    for (const l of fo.lines) this.orderQuantities.set(l.id, l.quantity);
    this.fulfillmentOrders.push(fo);
    return fo;
  }

  async *downloadLines(url: string) {
    const op = this.bulk.find((b) => url === `fake://bulk/${b.id}`)!;
    const root = /^\{\s*(\w+)/.exec(op.query)?.[1] as string;
    const rows =
      root === 'inventoryItems'
        ? this.store.inventory
        : root === 'orders'
          ? this.store.orders
          : root === 'customers'
            ? this.store.customers
            : this.store.products;
    for (const row of rows)
      yield JSON.stringify(root === 'orders' ? this.asAsked(row, op.query) : row);
  }

  /** An order row with only the buyer details the export asked for, as Shopify returns it. */
  private asAsked(row: object, query: string) {
    const r = { ...(row as Record<string, unknown>) };
    if (!/\bemail phone\b/.test(query)) {
      delete r.email;
      delete r.phone;
      delete r.customer;
      if (r.shippingAddress) {
        const { province, city, countryCodeV2 } = r.shippingAddress as Record<string, unknown>;
        r.shippingAddress = { province, city, countryCodeV2 };
      }
    }
    if (!query.includes('shippingAddress')) delete r.shippingAddress;
    return r;
  }

  /** Token endpoint calls, to check renewals happen once and only when due. */
  tokenCalls: string[] = [];
  /** The refresh token Shopify would accept next; using it retires it. */
  private liveRefresh = 'shprt_1';

  /** The app (client id) each token call was made with. */
  tokenApps: string[] = [];

  async exchangeCode(_shop: string, code: string, app?: { clientId: string }) {
    if (code !== 'good-code') throw new Error('bad code');
    this.tokenCalls.push('code');
    this.tokenApps.push(app?.clientId ?? '');
    this.liveRefresh = 'shprt_1';
    return {
      accessToken: 'shpat_test_token',
      scope: 'read_products,write_inventory,read_orders',
      expiresIn: 3600,
      refreshToken: this.liveRefresh,
      refreshTokenExpiresIn: 7_776_000,
    };
  }

  async refreshToken(_shop: string, refreshToken: string, app?: { clientId: string }) {
    this.tokenCalls.push('refresh');
    this.tokenApps.push(app?.clientId ?? '');
    if (refreshToken !== this.liveRefresh)
      throw new Error('token refresh failed (400 invalid_grant)');
    this.liveRefresh = `shprt_${this.tokenCalls.length + 1}`;
    return {
      accessToken: 'shpat_test_token',
      scope: '',
      expiresIn: 3600,
      refreshToken: this.liveRefresh,
      refreshTokenExpiresIn: 7_776_000,
    };
  }

  /** Refuse the client credentials grant, like an app from another organization */
  denyClientCredentials = false;

  async clientCredentials(_shop: string, app?: { clientId: string }) {
    this.tokenCalls.push('client');
    this.tokenApps.push(app?.clientId ?? '');
    if (this.denyClientCredentials)
      throw new Error('client credentials failed (400 invalid_client)');
    return {
      accessToken: 'shpat_test_token',
      scope: 'read_products,write_inventory,read_orders,read_customers',
      expiresIn: 86399,
    };
  }

  async migrateToken(_shop: string, legacyToken: string) {
    this.tokenCalls.push('migrate');
    if (legacyToken !== 'shpat_test_token') throw new Error('token migration failed (400)');
    return this.refreshToken(_shop, this.liveRefresh);
  }

  async graphql<T>(
    _shop: string,
    token: string,
    query: string,
    v: Record<string, unknown> = {},
  ): Promise<T> {
    if (token !== 'shpat_test_token') throw new Error('bad token');
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'unknown';
    this.calls.push(name);
    const ok = (data: unknown) => data as T;
    const errors = { userErrors: [] as { message: string }[] };
    const fo = (id: unknown) => this.fulfillmentOrders.find((f) => f.id === id)!;

    switch (name) {
      case 'BulkRun': {
        const query = String(v.query);
        const op = { id: gid('BulkOperation'), query, polls: 0 } as FakeShopify['bulk'][number];
        const contact = query.includes('defaultEmailAddress') || /\bemail phone\b/.test(query);
        if (
          ((this.denyContact || this.denyAddresses) && contact) ||
          (this.denyAddresses && query.includes('shippingAddress'))
        ) {
          op.status = 'FAILED';
          op.errorCode = 'ACCESS_DENIED';
        }
        this.bulk.push(op);
        return ok({
          bulkOperationRunQuery: { bulkOperation: { id: op.id, status: 'CREATED' }, ...errors },
        });
      }
      case 'BulkStatus': {
        const op = this.bulk.find((b) => b.id === v.id)!;
        // Running on the first look, finished on the next.
        const status = op.status ?? (op.polls++ === 0 ? 'RUNNING' : 'COMPLETED');
        return ok({
          node: {
            id: op.id,
            status,
            errorCode: op.errorCode ?? null,
            objectCount: '0',
            url: status === 'COMPLETED' ? `fake://bulk/${op.id}` : null,
          },
        });
      }
      case 'ShopProfile':
        return ok({
          shop: {
            id: 'gid://shopify/Shop/1',
            name: 'Test Shop',
            currencyCode: 'EGP',
            createdAt: '2022-03-01T10:00:00Z',
            plan: { displayName: 'Basic', partnerDevelopment: true, shopifyPlus: false },
          },
          productsCount: { count: this.store.products.length },
          locations: { nodes: [] },
        });
      case 'CustomerForData': {
        const rows = this.store.customers as { id?: string }[];
        return ok({ customer: rows.find((r) => r.id === v.id) ?? null });
      }
      case 'OrderForData': {
        const rows = this.store.orders as { id?: string; __parentId?: string }[];
        const order = rows.find((r) => r.id === v.id);
        return ok({
          order: order
            ? { ...order, lineItems: { nodes: rows.filter((r) => r.__parentId === v.id) } }
            : null,
        });
      }
      case 'FulfillmentServices':
        return ok({
          shop: {
            fulfillmentServices: this.services.map((s) => ({
              id: s.id,
              serviceName: s.name,
              callbackUrl: s.callbackUrl,
              location: { id: s.locationId },
            })),
          },
        });
      case 'FulfillmentServiceUpdate': {
        const s = this.services.find((x) => x.id === v.id)!;
        s.callbackUrl = String(v.callbackUrl);
        return ok({ fulfillmentServiceUpdate: { fulfillmentService: { id: s.id }, ...errors } });
      }
      case 'FulfillmentServiceDelete':
        this.services = this.services.filter((x) => x.id !== v.id);
        return ok({ fulfillmentServiceDelete: { deletedId: v.id, ...errors } });
      case 'CarrierServiceDelete':
        this.carrierServices = this.carrierServices.filter((x) => x.id !== v.id);
        return ok({ carrierServiceDelete: { deletedId: v.id, ...errors } });
      case 'FulfillmentServiceCreate': {
        // Shopify refuses a second service with the same name in one shop.
        if (this.services.some((x) => x.name === String(v.name)))
          return ok({
            fulfillmentServiceCreate: {
              fulfillmentService: null,
              userErrors: [{ field: ['name'], message: 'Name has already been taken' }],
            },
          });
        const s = {
          id: gid('FulfillmentService'),
          name: String(v.name),
          callbackUrl: String(v.callbackUrl),
          locationId: gid('Location'),
        };
        this.services.push(s);
        return ok({
          fulfillmentServiceCreate: {
            fulfillmentService: { id: s.id, location: { id: s.locationId } },
            ...errors,
          },
        });
      }
      case 'ProductVariants':
        return ok({
          productVariants: {
            nodes: this.variants.map((x) => ({
              id: x.id,
              sku: x.sku,
              barcode: x.barcode,
              price: x.price,
              title: x.title,
              inventoryItem: { id: x.inventoryItemId },
              product: { id: `${x.id}-product`, title: x.product, status: 'ACTIVE' },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      case 'AssignedFulfillmentOrders': {
        const list = this.fulfillmentOrders.filter(
          (f) =>
            f.assignment === v.status &&
            (!v.locationIds || (v.locationIds as string[]).includes(f.locationId)),
        );
        return ok({
          assignedFulfillmentOrders: {
            nodes: list.map((f) => ({
              id: f.id,
              status: 'OPEN',
              requestStatus: f.assignment,
              assignedLocation: { location: { id: f.locationId } },
              destination: {
                firstName: 'Sara',
                lastName: 'Ali',
                phone: f.address.phone,
                address1: f.address.address1,
                address2: null,
                city: f.address.city,
                province: 'Cairo',
              },
              order: {
                id: f.orderId,
                name: f.name,
                phone: null,
                note: 'Ring twice',
                totalOutstandingSet: { shopMoney: { amount: f.outstanding, currencyCode: 'EGP' } },
                shippingAddress: { ...f.address, address2: null, province: 'Cairo' },
                shippingLines: {
                  nodes: [
                    {
                      title: '60 minutes',
                      code:
                        f.shippingCode !== undefined
                          ? f.shippingCode
                          : `SN60:${this.locationAddresses.get(f.locationId)?.address2.replace('Shiply Now ', '')}`,
                      discountedPriceSet: { shopMoney: { amount: f.shipping } },
                    },
                  ],
                },
              },
              lineItems: {
                nodes: f.lines.map((l) => ({
                  id: `${l.id}-fo`,
                  sku: l.sku,
                  remainingQuantity: l.quantity,
                  totalQuantity: l.quantity,
                  variant: { id: l.variantId },
                  lineItem: {
                    id: l.id,
                    sku: l.sku,
                    discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: l.price } },
                  },
                })),
              },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      }
      case 'AcceptFulfillmentRequest':
        fo(v.id).assignment = 'FULFILLMENT_ACCEPTED';
        return ok({
          fulfillmentOrderAcceptFulfillmentRequest: { fulfillmentOrder: { id: v.id }, ...errors },
        });
      case 'RejectFulfillmentRequest':
        fo(v.id).assignment = 'CLOSED';
        fo(v.id).rejected = { reason: String(v.reason), message: String(v.message) };
        return ok({
          fulfillmentOrderRejectFulfillmentRequest: { fulfillmentOrder: { id: v.id }, ...errors },
        });
      case 'AcceptCancellationRequest':
        fo(v.id).assignment = 'CLOSED';
        return ok({
          fulfillmentOrderAcceptCancellationRequest: { fulfillmentOrder: { id: v.id }, ...errors },
        });
      case 'RejectCancellationRequest':
        fo(v.id).assignment = 'FULFILLMENT_ACCEPTED';
        return ok({
          fulfillmentOrderRejectCancellationRequest: { fulfillmentOrder: { id: v.id }, ...errors },
        });
      case 'FulfillmentCreate': {
        const input = v.fulfillment as {
          lineItemsByFulfillmentOrder: { fulfillmentOrderId: string }[];
          trackingInfo: { number: string; url?: string };
        };
        const f = {
          id: gid('Fulfillment'),
          fulfillmentOrderId: input.lineItemsByFulfillmentOrder[0]!.fulfillmentOrderId,
          tracking: input.trackingInfo.number,
          trackingUrl: input.trackingInfo.url,
          events: [] as string[],
        };
        this.fulfillments.push(f);
        return ok({
          fulfillmentCreate: { fulfillment: { id: f.id, status: 'SUCCESS' }, ...errors },
        });
      }
      case 'FulfillmentEventCreate': {
        const input = v.fulfillmentEvent as { fulfillmentId: string; status: string };
        this.fulfillments.find((f) => f.id === input.fulfillmentId)!.events.push(input.status);
        return ok({
          fulfillmentEventCreate: {
            fulfillmentEvent: { id: gid('FulfillmentEvent'), status: input.status },
            ...errors,
          },
        });
      }
      case 'OrderEditBegin': {
        const order = this.fulfillmentOrders.find((f) => f.orderId === v.id)!;
        return ok({
          orderEditBegin: {
            calculatedOrder: {
              id: `calc-${order.orderId}`,
              lineItems: {
                nodes: order.lines.map((l) => ({
                  id: `calc-${l.id}`,
                  sku: l.sku,
                  quantity: this.orderQuantities.get(l.id),
                  variant: { id: l.variantId },
                })),
              },
            },
            ...errors,
          },
        });
      }
      case 'OrderEditSetQuantity':
        this.orderQuantities.set(String(v.lineItemId).replace('calc-', ''), Number(v.quantity));
        return ok({ orderEditSetQuantity: { calculatedOrder: { id: v.id }, ...errors } });
      case 'OrderEditCommit':
        return ok({ orderEditCommit: { order: { id: v.id }, ...errors } });
      case 'InventoryActivate':
        this.idempotencyKeys.push(String(v.key));
        this.inventory.set(`${v.inventoryItemId}|${v.locationId}`, Number(v.available));
        return ok({
          inventoryActivate: { inventoryLevel: { id: gid('InventoryLevel') }, ...errors },
        });
      case 'InventorySetQuantities': {
        this.idempotencyKeys.push(String(v.key));
        const input = v.input as {
          quantities: {
            inventoryItemId: string;
            locationId: string;
            quantity: number;
            changeFromQuantity: null;
          }[];
        };
        for (const q of input.quantities) {
          if (q.changeFromQuantity !== null)
            throw new Error('changeFromQuantity must be explicitly null');
          this.inventory.set(`${q.inventoryItemId}|${q.locationId}`, q.quantity);
        }
        return ok({
          inventorySetQuantities: {
            inventoryAdjustmentGroup: { id: gid('InventoryAdjustmentGroup') },
            ...errors,
          },
        });
      }
      case 'CarrierServiceCreate': {
        const input = v.input as { name: string; callbackUrl: string };
        const c = {
          id: gid('DeliveryCarrierService'),
          name: input.name,
          callbackUrl: input.callbackUrl,
        };
        this.carrierServices.push(c);
        return ok({ carrierServiceCreate: { carrierService: { id: c.id }, ...errors } });
      }
      case 'LocationEdit': {
        const input = v.input as {
          name: string;
          address: { address1: string; address2: string; city: string; provinceCode: string };
        };
        this.locationAddresses.set(String(v.id), { name: input.name, ...input.address });
        return ok({ locationEdit: { location: { id: v.id }, ...errors } });
      }
      case 'WebhookSubscriptions':
        return ok({ webhookSubscriptions: { nodes: this.webhooks } });
      case 'WebhookSubscriptionCreate': {
        const input = v.webhookSubscription as { uri: string };
        const w = { id: gid('WebhookSubscription'), topic: String(v.topic), uri: input.uri };
        this.webhooks.push(w);
        return ok({ webhookSubscriptionCreate: { webhookSubscription: { id: w.id }, ...errors } });
      }
      case 'WebhookSubscriptionUpdate': {
        const w = this.webhooks.find((x) => x.id === v.id)!;
        w.uri = (v.webhookSubscription as { uri: string }).uri;
        return ok({ webhookSubscriptionUpdate: { webhookSubscription: { id: w.id }, ...errors } });
      }
      default:
        throw new Error(`fake Shopify does not know ${name}`);
    }
  }
}
