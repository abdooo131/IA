import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCountsController } from './admin-counts.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminMerchantsController } from './admin-merchants.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminManifestsController } from './admin-manifests.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersModule } from '../orders/orders.module';
import { AdminStoresController } from './admin-stores.controller';
import { AdminZonesController } from './admin-zones.controller';

@Module({
  imports: [CoverageModule, OrdersModule],
  controllers: [
    AdminStoresController,
    AdminCatalogController,
    AdminZonesController,
    AdminCountsController,
    AdminManifestsController,
    AdminOrdersController,
    AdminDashboardController,
    AdminSettingsController,
    AdminUsersController,
    AdminMerchantsController,
  ],
})
export class AdminModule {}
