import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AdminDataController } from './admin-data.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { MerchantShopifyController } from './merchant-shopify.controller';
import { ShopDataService } from './shop-data.service';
import { HttpShopifyAdmin, ShopifyAdmin } from './shopify-admin';
import { ShopifyAdminController } from './shopify-admin.controller';
import { ShopifyJobsService } from './shopify-jobs.service';
import { ShopifyOrdersService } from './shopify-orders.service';
import { ShopifyPublicController } from './shopify-public.controller';
import { ShopifyRatesService } from './shopify-rates.service';
import { ShopifyStorefrontController } from './shopify-storefront.controller';
import { ShopifySetupService } from './shopify-setup.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

@Module({
  imports: [CoverageModule],
  providers: [
    { provide: ShopifyAdmin, useClass: HttpShopifyAdmin },
    ShopifyService,
    ShopifySetupService,
    ShopifyOrdersService,
    ShopifySyncService,
    ShopifyJobsService,
    ShopifyRatesService,
    ShopDataService,
  ],
  controllers: [
    ShopifyPublicController,
    ShopifyAdminController,
    ShopifyStorefrontController,
    AdminDataController,
    AdminCustomersController,
    MerchantShopifyController,
  ],
  exports: [ShopifyJobsService],
})
export class ShopifyModule {}
