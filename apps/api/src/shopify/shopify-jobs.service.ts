import { ErrorReporter } from '../common/error-reporter';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pruneShopifyRecords, type ShopifyShop } from '@shiplynow/db';
import type { Env } from '../config/env';
import { ShopDataService } from './shop-data.service';
import { ShopifyOrdersService } from './shopify-orders.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

const EVERY_MS = 20_000;
/** The store data import (bulk exports) runs on its own, slower timer. */
const DATA_EVERY_MS = 60_000;
/** Old Shopify logs and finished outbox calls are deleted once a day. */
const PRUNE_EVERY_MS = 24 * 3600_000;

/**
 * Keeps every connected shop in step: pending outbox calls, any fulfillment or cancellation
 * request Shopify sent (in case a notification was lost) and changed stock levels. Each part
 * is safe to run twice, and one run at a time per instance. The merchant's store data import
 * (products, orders and customers by bulk export) has its own loop, so a long download never
 * holds up orders or stock.
 */
@Injectable()
export class ShopifyJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ShopifyJobs');
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private dataRunning = false;
  private prunedAt = 0;
  /** The sync running for each shop; a second caller waits for it instead of starting another. */
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** The store data step running for each shop (never shared with the order sync). */
  private readonly dataInFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly shopify: ShopifyService,
    private readonly orders: ShopifyOrdersService,
    private readonly sync: ShopifySyncService,
    private readonly shopData: ShopDataService,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
  ) {}

  onApplicationBootstrap() {
    const setting = this.config.get('JOBS_ENABLED', { infer: true });
    const enabled = setting
      ? setting === 'true'
      : this.config.get('NODE_ENV', { infer: true }) !== 'test';
    if (!enabled || !this.shopify.configured) return;
    this.timers = [
      setInterval(() => void this.runAll(), EVERY_MS),
      setInterval(() => void this.runData(), DATA_EVERY_MS),
    ];
    for (const timer of this.timers) timer.unref();
  }

  onApplicationShutdown() {
    for (const timer of this.timers) clearInterval(timer);
  }

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const shop of await this.shopify.activeShops()) await this.runShop(shop);
      await this.prune();
    } finally {
      this.running = false;
    }
  }

  /** The store data import for every shop, one after another, on its own timer. */
  async runData() {
    if (this.dataRunning) return;
    this.dataRunning = true;
    try {
      for (const shop of await this.shopify.activeShops()) await this.runShopData(shop);
    } finally {
      this.dataRunning = false;
    }
  }

  /** One shop: outbox first (so Shopify hears what already happened), then requests, then stock. */
  runShop(shop: ShopifyShop) {
    const running = this.inFlight.get(shop.id);
    if (running) return running as ReturnType<ShopifyJobsService['syncShop']>;
    const run = this.syncShop(shop).finally(() => this.inFlight.delete(shop.id));
    this.inFlight.set(shop.id, run);
    return run;
  }

  /** One step of a shop's store data import; a second caller shares the running one. */
  runShopData(shop: ShopifyShop) {
    const running = this.dataInFlight.get(shop.id);
    if (running) return running;
    const run = this.shopData
      .tick(shop)
      .catch((error: unknown) => {
        void this.reporter.report(`job: store data ${shop.shopDomain}`, error);
        return null;
      })
      .finally(() => this.dataInFlight.delete(shop.id));
    this.dataInFlight.set(shop.id, run);
    return run;
  }

  /** Deletes old Shopify logs and finished outbox calls, at most once a day per instance. */
  async prune(now: Date = new Date()) {
    if (now.getTime() - this.prunedAt < PRUNE_EVERY_MS) return null;
    this.prunedAt = now.getTime();
    try {
      const pruned = await pruneShopifyRecords(this.shopify.prisma, now);
      if (pruned.logs || pruned.outbox)
        this.log.log(`pruned ${pruned.logs} log rows and ${pruned.outbox} outbox calls`);
      return pruned;
    } catch (error) {
      await this.reporter.report('job: Shopify prune', error);
      return null;
    }
  }

  private async syncShop(shop: ShopifyShop) {
    try {
      const outbox = await this.sync.processOutbox(shop);
      const requests = await this.orders.sweep(shop);
      const accepts = await this.orders.reconcileAccepts(shop);
      const stock = await this.sync.pushStock(shop);
      return { outbox, requests, accepts, stock };
    } catch (error) {
      await this.reporter.report(`job: Shopify sync ${shop.shopDomain}`, error);
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'sync',
        ok: false,
        message: (error as Error).message,
      });
      return null;
    }
  }
}
