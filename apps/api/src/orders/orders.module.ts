import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { GeoModule } from '../geo/geo.module';
import { LabelService } from '../labels/label.service';
import { PricingModule } from '../pricing/pricing.module';
import { CsvImportService } from './csv-import.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AppConfigModule, GeoModule, PricingModule],
  controllers: [OrdersController],
  providers: [OrdersService, CsvImportService, LabelService],
  exports: [OrdersService],
})
export class OrdersModule {}
