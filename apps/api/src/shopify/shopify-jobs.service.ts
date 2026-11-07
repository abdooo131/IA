import { ErrorReporter } from '../common/error-reporter';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ShopifyShop } from '@shiplynow/db';
import type { Env } from '../config/env';
import { ShopDataService } from './shop-data.service';
import { ShopifyOrdersService } from './shopify-orders.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

const EVERY_MS = 20_000;

/**
 * Keeps every connected shop in step: pending outbox calls, any fulfillment or cancellation
 * request Shopify sent (in case a notification was lost) and changed stock levels. Each part
 * is safe to run twice, and one run at a time per instance.
 */
@Injectable()
export class ShopifyJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ShopifyJobs');
  private timer?: NodeJS.Timeout;
  private running = false;
  /** The sync running for each shop; a second caller waits for it instead of starting another. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

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
    this.timer = setInterval(() => void this.runAll(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const shop of await this.shopify.activeShops()) await this.runShop(shop);
    } finally {
      this.running = false;
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

  private async syncShop(shop: ShopifyShop) {
    try {
      const outbox = await this.sync.processOutbox(shop);
      const requests = await this.orders.sweep(shop);
      const stock = await this.sync.pushStock(shop);
      // The merchant's store data: a separate step, so its trouble never holds up orders.
      const data = await this.shopData
        .tick(shop)
        .catch(
          (error: unknown) =>
            void this.reporter.report(`job: store data ${shop.shopDomain}`, error),
        );
      return { outbox, requests, stock, data };
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
