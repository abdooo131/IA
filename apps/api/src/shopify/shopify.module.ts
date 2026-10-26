import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { HttpShopifyAdmin, ShopifyAdmin } from './shopify-admin';
import { ShopifyAdminController } from './shopify-admin.controller';
import { ShopifyJobsService } from './shopify-jobs.service';
import { ShopifyOrdersService } from './shopify-orders.service';
import { ShopifyPublicController } from './shopify-public.controller';
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
  ],
  controllers: [ShopifyPublicController, ShopifyAdminController],
  exports: [ShopifyJobsService],
})
export class ShopifyModule {}
