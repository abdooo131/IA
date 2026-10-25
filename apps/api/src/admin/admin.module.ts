import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCountsController } from './admin-counts.controller';
import { AdminManifestsController } from './admin-manifests.controller';
import { AdminStoresController } from './admin-stores.controller';
import { AdminZonesController } from './admin-zones.controller';

@Module({
  imports: [CoverageModule],
  controllers: [
    AdminStoresController,
    AdminCatalogController,
    AdminZonesController,
    AdminCountsController,
    AdminManifestsController,
  ],
})
export class AdminModule {}
