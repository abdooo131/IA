import { Injectable, Logger } from '@nestjs/common';
import {
  ingestInventory,
  ingestOrders,
  ingestProducts,
  type Prisma,
  type ShopifyShop,
} from '@shiplynow/db';
import { ErrorReporter } from '../common/error-reporter';
import {
  BULK_RUN,
  BULK_STATUS,
  inventoryExport,
  orderForData,
  ordersExport,
  productsExport,
  SHOP_PROFILE,
} from './graphql';
import { assertNoUserErrors, ShopifyAdmin } from './shopify-admin';
import { ShopifyService } from './shopify.service';

const KINDS = ['products', 'inventory', 'orders'] as const;
type Kind = (typeof KINDS)[number];
/** A kind is exported again (only what changed) when its last export is older than this. */
const REFRESH_MS = 24 * 3600_000;
const BATCH = 500;

type Line = Record<string, unknown> & { id?: string; __parentId?: string };

/**
 * Collects each merchant's whole store from Shopify: products and variants, stock per location,
 * and orders, through bulk exports (one at a time per shop, as Shopify allows). The first run
 * takes everything; later runs take only what changed since the last one. Each step is saved
 * by Shopify id, so a step repeated after a restart changes nothing.
 *
 *   products ──▶ inventory ──▶ orders ──▶ (24 h later) products changed since … and so on
 */
@Injectable()
export class ShopDataService {
  private readonly log = new Logger('ShopData');

  constructor(
    private readonly shopify: ShopifyService,
    private readonly admin: ShopifyAdmin,
    private readonly reporter: ErrorReporter,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  /** One step for one shop: finish the running export, or start the next one that is due. */
  async tick(shop: ShopifyShop, now: Date = new Date()) {
    const running = await this.prisma.shopDataSync.findFirst({
      where: { shopId: shop.id, status: 'running' },
      orderBy: { startedAt: 'asc' },
    });
    if (running) return this.poll(shop, running.id);
    for (const kind of KINDS) {
      const last = await this.prisma.shopDataSync.findFirst({
        where: { shopId: shop.id, kind, status: 'done' },
        orderBy: { startedAt: 'desc' },
      });
      if (last && now.getTime() - last.startedAt.getTime() < REFRESH_MS) continue;
      // Stock is cheap to read whole; products and orders only bring what changed.
      return this.start(shop, kind, kind === 'inventory' ? undefined : last?.startedAt);
    }
    return null;
  }

  /** Admin's "Collect everything again": the next exports take the whole store. */
  async refreshAll(shopId: string) {
    await this.prisma.shopDataSync.updateMany({
      where: { shopId, status: 'done' },
      data: { status: 'superseded' },
    });
  }

  async start(shop: ShopifyShop, kind: Kind, since?: Date, limited?: string) {
    const query =
      kind === 'products'
        ? productsExport(since)
        : kind === 'inventory'
          ? inventoryExport()
          : ordersExport(since, limited !== 'addresses');
    const data = await this.shopify.call<{
      bulkOperationRunQuery: {
        bulkOperation: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(shop, BULK_RUN, { query });
    assertNoUserErrors('bulkOperationRunQuery', data.bulkOperationRunQuery);
    const sync = await this.prisma.shopDataSync.create({
      data: {
        shopId: shop.id,
        kind,
        since: since ?? null,
        limited: limited ?? null,
        bulkOperationId: data.bulkOperationRunQuery.bulkOperation!.id,
      },
    });
    await this.shopify.record(shop.id, {
      direction: 'out',
      kind: `data_${kind}`,
      ok: true,
      message: since ? `changed since ${since.toISOString()}` : 'everything',
    });
    return { started: kind, id: sync.id };
  }

  private async poll(shop: ShopifyShop, syncId: string) {
    const sync = await this.prisma.shopDataSync.findUniqueOrThrow({ where: { id: syncId } });
    const data = await this.shopify.call<{
      node: {
        status: string;
        errorCode: string | null;
        objectCount: string;
        url: string | null;
      } | null;
    }>(shop, BULK_STATUS, { id: sync.bulkOperationId });
    const op = data.node;
    if (!op || ['CREATED', 'RUNNING', 'CANCELING'].includes(op.status))
      return { running: sync.kind };
    if (op.status !== 'COMPLETED') {
      await this.fail(shop, sync.id, `${op.status} ${op.errorCode ?? ''}`.trim());
      // Shopify may refuse order addresses (protected customer data): try again without them.
      if (
        sync.kind === 'orders' &&
        op.errorCode === 'ACCESS_DENIED' &&
        sync.limited !== 'addresses'
      )
        return this.start(shop, 'orders', sync.since ?? undefined, 'addresses');
      return { failed: sync.kind };
    }
    try {
      const count = op.url ? await this.ingest(shop, sync.kind as Kind, op.url) : 0;
      await this.prisma.shopDataSync.update({
        where: { id: sync.id },
        data: { status: 'done', objectCount: count, finishedAt: new Date() },
      });
      if (sync.kind === 'products') await this.refreshProfile(shop);
      await this.prisma.shopifyShop.update({
        where: { id: shop.id },
        data: { dataSyncedAt: new Date() },
      });
      return { done: sync.kind, count };
    } catch (error) {
      await this.fail(shop, sync.id, (error as Error).message);
      void this.reporter.report('shop_data_ingest', error);
      return { failed: sync.kind };
    }
  }

  private async fail(shop: ShopifyShop, syncId: string, error: string) {
    await this.prisma.shopDataSync.update({
      where: { id: syncId },
      data: { status: 'failed', error: error.slice(0, 300), finishedAt: new Date() },
    });
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'data_sync',
      ok: false,
      message: error,
    });
  }

  /** Reads the export line by line and saves it in batches; answers how many lines it read. */
  private async ingest(shop: ShopifyShop, kind: Kind, url: string) {
    const ours = new Set(
      (await this.prisma.shopifyLocation.findMany({ where: { shopId: shop.id } })).map(
        (l) => l.locationId,
      ),
    );
    let batch: Line[] = [];
    let count = 0;
    const flush = async () => {
      if (kind === 'products') await ingestProducts(this.prisma, shop, batch);
      else if (kind === 'inventory') await ingestInventory(this.prisma, shop, batch, ours);
      else await ingestOrders(this.prisma, shop, batch);
      batch = [];
    };
    for await (const line of this.admin.downloadLines(url)) {
      batch.push(JSON.parse(line) as Line);
      count++;
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    return count;
  }

  /** The store's profile (name, plan, currency, age, locations), kept on the shop row. */
  async refreshProfile(shop: ShopifyShop) {
    const data = await this.shopify.call<Record<string, unknown>>(shop, SHOP_PROFILE);
    await this.prisma.shopifyShop.update({
      where: { id: shop.id },
      data: { profile: data as Prisma.InputJsonValue },
    });
  }

  /** orders/create and orders/updated: fetch that one order and save it at once. */
  async orderWebhook(shop: ShopifyShop, orderGid: string) {
    const lastOrders = await this.prisma.shopDataSync.findFirst({
      where: { shopId: shop.id, kind: 'orders' },
      orderBy: { startedAt: 'desc' },
    });
    const address = lastOrders?.limited !== 'addresses';
    const data = await this.shopify.call<{
      order: (Line & { lineItems?: { nodes: Line[] } }) | null;
    }>(shop, orderForData(address), { id: orderGid });
    if (!data.order) return null;
    const { lineItems, ...order } = data.order;
    const lines: Line[] = [
      order,
      ...(lineItems?.nodes ?? []).map((l) => ({ ...l, __parentId: order.id })),
    ];
    return ingestOrders(this.prisma, shop, lines);
  }
}
